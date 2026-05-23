import {
    TransactionListRequest, TransactionListResponse,
    SubscriptionTopupRequest, SubscriptionTopupResponse,
    TransactionDTO,
    StatementRequest, StatementResponse, StatementItem,
    PaymentCurrency,
} from "../../../shared/modules/subscription_record/subscription_record.interface";
import { TransactionRouterInstance } from "../../../shared/modules/subscription_record/subscription_record.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, getAccountByEmail } from "../auth/auth.service";
import { SubscriptionService } from "./subscription.service";
import { createInvoice } from "./nowpayments.service";
import { AccountService } from "../account/account.service";
import Repository from "../../lib/repository";
import crypto from "crypto";
import { SettingsService } from "../settings/settings.service";

function verifyNowPaymentsSignature(rawBody: string, signature: string, secret: string): boolean {
    const hmac = crypto.createHmac("sha512", secret);
    hmac.update(rawBody);
    return hmac.digest("hex") === signature;
}

async function resolveAccount(auth: string) {
    const email = getIdentifyByVerify(auth);
    if (!email) throw new Error("Unauthorized");
    const account = await getAccountByEmail(email);
    if (!account) throw new Error("Account not found");
    return account;
}

// ─── Rate limiter ───

const requestCounts = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 6; // max requests per window

async function checkRateLimit(key: string): Promise<boolean> {
    const now = Date.now();
    const entry = requestCounts.get(key);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        requestCounts.set(key, { count: 1, windowStart: now });
        return true;
    }

    if (entry.count >= RATE_LIMIT_MAX) {
        return false;
    }

    entry.count++;
    return true;
}

// Clean up stale entries every 2 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of requestCounts) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
            requestCounts.delete(key);
        }
    }
}, 120_000);

// ─── Record routes ───

async function records(request: TransactionListRequest): Promise<TransactionListResponse> {
    request = TransactionListRequest.self(request);
    const account = await resolveAccount(request.auth || "");
    const data = await SubscriptionService.getRecordsByAccount(account.id);
    const list = data.map(item => new TransactionDTO(item));
    return new TransactionListResponse({
        success: true,
        message: "success",
        data: { list },
    });
}

/**
 * Create a top-up invoice.
 * User purchases raw tokens at a flat rate (1 USD per token).
 */
async function createtopup(request: SubscriptionTopupRequest): Promise<SubscriptionTopupResponse> {
    request = SubscriptionTopupRequest.self(request);
    const account = await resolveAccount(request.auth || "");

    // Rate limit: max 6 requests per minute per account
    if (!(await checkRateLimit(`createtopup:${account.id}`))) {
        return new SubscriptionTopupResponse({
            success: false,
            message: "Too many requests, please try again later",
            data: { invoice_url: "", payment_id: "", token_amount: 0, price_dollars: 0 },
        });
    }

    const tokenAmount = request.token_amount || 0;
    if (tokenAmount <= 0) throw new Error("token_amount must be positive");

    // 1 token = 1 USD
    const finalPrice = tokenAmount;

    const payCurrency = (request.pay_currency as PaymentCurrency) || "USDTERC20";
    const { invoice_url, payment_id, invoice_id } = await createInvoice(
        finalPrice,
        account.id,
        payCurrency,
    );

    // Create a pending record
    await SubscriptionService.createRecord({
        account_id: account.id,
        txid: invoice_id,
        amount: finalPrice,
        confirmations: 0,
        status: "pending",
        type: "topup",
    });

    return new SubscriptionTopupResponse({
        success: true,
        message: "success",
        data: { invoice_url, payment_id, token_amount: tokenAmount, price_dollars: finalPrice },
    });
}

// ─── Statement (unified balance history) ───

async function statement(request: StatementRequest): Promise<StatementResponse> {
    request = StatementRequest.self(request);
    const account = await resolveAccount(request.auth || "");

    // 1. Confirmed topup transactions
    const txRepo = Repository.instance<any>("Transaction");
    const txs = await txRepo.find({ account_id: account.id, status: "confirmed", delete_time: null });

    // 2. Redeemed gift cards (bonus & redeemed codes)
    const cardRepo = Repository.instance<any>("gift_card");
    const cards = await cardRepo.find({ redeemed_by: account.id, status: "redeemed" });

    // 3. Usage logs (AI call costs) — grouped by day + model
    const usageRepo = Repository.instance<any>("usage_log");
    const usageLogs = await usageRepo.find({ account_id: account.id, delete_time: null });

    // Group by "day|model_alias"
    const dailyModelUsage = new Map<string, { logs: any[]; maxTimestamp: number }>();
    for (const log of usageLogs) {
        const day = new Date(log.create_time).toISOString().slice(0, 10); // "2026-05-12"
        const model = log.model_alias || "Unknown";
        const key = `${day}|${model}`;
        if (!dailyModelUsage.has(key)) {
            dailyModelUsage.set(key, { logs: [], maxTimestamp: 0 });
        }
        const entry = dailyModelUsage.get(key)!;
        entry.logs.push(log);
        if (log.create_time > entry.maxTimestamp) entry.maxTimestamp = log.create_time;
    }

    const items: StatementItem[] = [];

    for (const tx of txs) {
        items.push(new StatementItem({
            id: tx.id,
            type: "topup",
            amount: tx.amount,
            description: "Topup",
            remark: `#${tx.txid || tx.id?.slice(0, 8)}`,
            create_time: tx.create_time,
        }));
    }

    for (const card of cards) {
        if (card.code.startsWith("daily_")) {
            const ts = (card.redeemed_at || card.create_time).toString().slice(-10);
            items.push(new StatementItem({
                id: card.id,
                type: "bonus",
                amount: card.token_amount,
                description: "Daily Bonus",
                remark: `#${ts}`,
                create_time: card.redeemed_at || card.create_time,
            }));
        } else if (card.code.startsWith("register_")) {
            const ts = (card.redeemed_at || card.create_time).toString().slice(-10);
            items.push(new StatementItem({
                id: card.id,
                type: "bonus",
                amount: card.token_amount,
                description: "Registration Bonus",
                remark: `#${ts}`,
                create_time: card.redeemed_at || card.create_time,
            }));
        } else {
            items.push(new StatementItem({
                id: card.id,
                type: "gift_card",
                amount: card.token_amount,
                description: "Gift Card Redeemed",
                remark: `#${card.code.slice(0, 20)}`,
                create_time: card.redeemed_at || card.create_time,
            }));
        }
    }

    // One entry per day per model
    for (const [key, entry] of dailyModelUsage) {
        const model = key.split("|")[1];
        items.push(new StatementItem({
            id: `usage_${key}`,
            type: "usage",
            amount: AccountService.computeUsageCost(entry.logs),
            description: "AI Usage",
            remark: model,
            create_time: entry.maxTimestamp,
        }));
    }

    // Sort by time descending (most recent first)
    items.sort((a, b) => b.create_time - a.create_time);

    return new StatementResponse({
        success: true,
        message: "success",
        data: { list: items },
    });
}

/**
 * Handle NowPayments IPN (Instant Payment Notification) webhook.
 * NowPayments POSTs here when payment status changes.
 */
async function ipnwebhook(request: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
    // Verify NowPayments HMAC signature — required when IPN secret is configured
    const rawBody = (request as any).__raw_body as string || "";
    const headers = (request as any).__headers as Record<string, string> || {};
    const signature = headers["x-nowpayments-sig"] || headers["x-nowpayments-signature"] || "";
    const secret = SettingsService.get("ipn_secret");
    if (secret) {
        if (!signature || !rawBody) {
            console.warn("[IPN] Missing signature or raw body, rejecting webhook");
            return { success: false, message: "missing signature" };
        }
        const valid = verifyNowPaymentsSignature(rawBody, signature, secret);
        if (!valid) {
            console.warn("[IPN] Invalid signature, rejecting webhook");
            return { success: false, message: "invalid signature" };
        }
    }

    const paymentId = String(request.payment_id || "");
    const invoiceId = String(request.invoice_id || "");
    const paymentStatus = String(request.payment_status || "");
    const orderId = String(request.order_id || "");

    console.log(`[IPN] Webhook received: payment=${paymentId} status=${paymentStatus} order=${orderId}`);

    if (!paymentId) {
        return { success: false, message: "missing payment_id" };
    }

    try {
        const records = await SubscriptionService.findPendingRecords();
        const record = records.find(r => r.txid === invoiceId);

        if (!record) {
            console.log(`[IPN] No pending record found for payment ${paymentId}`);
            return { success: true, message: "no pending record" };
        }

        if (paymentStatus === "finished" || paymentStatus === "confirmed") {
            await SubscriptionService.updateRecordByTxid(record.txid, {
                payment_id: paymentId,
                status: "confirmed",
                confirmations: 1,
            });

            // Update account balance atomically
            await AccountService.updateBalance(record.account_id, record.amount);

            console.log(`[IPN] Account ${record.account_id} topped up ${record.amount} tokens`);
        } else if (paymentStatus === "failed" || paymentStatus === "expired" || paymentStatus === "refunded") {
            await SubscriptionService.updateRecordByTxid(record.txid, { status: "expired" });
        }

        return { success: true, message: "ok" };
    } catch (err) {
        console.error("[IPN] Error:", err);
        return { success: false, message: String(err) };
    }
}

// ─── Export controllers ───

export const subscriptionRecordController = new TransactionRouterInstance(inject, {
    records,
    createtopup,
    ipnwebhook,
    statement,
});

