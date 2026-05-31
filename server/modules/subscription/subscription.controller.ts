import {
    TransactionListRequest,
    SubscriptionTopupRequest,
    TransactionDTO,
    StatementRequest, StatementItem,
    PaymentCurrency,
} from "../../../shared/modules/subscription_record/subscription_record.interface";
import { subscriptionRoutes } from "../../../shared/modules/subscription_record/subscription_record.router";
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
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 6;

async function checkRateLimit(key: string): Promise<boolean> {
    const now = Date.now();
    const entry = requestCounts.get(key);

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        requestCounts.set(key, { count: 1, windowStart: now });
        return true;
    }

    if (entry.count >= RATE_LIMIT_MAX) return false;

    entry.count++;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of requestCounts) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
            requestCounts.delete(key);
        }
    }
}, 120_000);

// ─── Record routes ───

async function records(request: TransactionListRequest) {
    request = TransactionListRequest.self(request);
    const account = await resolveAccount(request.auth || "");
    const data = await SubscriptionService.getRecordsByAccount(account.id);
    const list = data.map(item => new TransactionDTO(item));
    return { list };
}

async function createtopup(request: SubscriptionTopupRequest) {
    request = SubscriptionTopupRequest.self(request);
    const account = await resolveAccount(request.auth || "");

    if (!(await checkRateLimit(`createtopup:${account.id}`))) {
        throw "Too many requests, please try again later";
    }

    const tokenAmount = request.token_amount || 0;
    if (tokenAmount <= 0) throw new Error("token_amount must be positive");

    const finalPrice = tokenAmount;

    const payCurrency = (request.pay_currency as PaymentCurrency) || "USDTERC20";
    const { invoice_url, payment_id, invoice_id } = await createInvoice(
        finalPrice,
        account.id,
        payCurrency,
    );

    await SubscriptionService.createRecord({
        account_id: account.id,
        txid: invoice_id,
        amount: finalPrice,
        confirmations: 0,
        status: "pending",
        type: "topup",
    });

    return { invoice_url, payment_id, token_amount: tokenAmount, price_dollars: finalPrice };
}

// ─── Statement (unified balance history) ───

async function statement(request: StatementRequest) {
    request = StatementRequest.self(request);
    const account = await resolveAccount(request.auth || "");

    const txRepo = Repository.instance<any>("Transaction");
    const txs = await txRepo.find({ account_id: account.id, status: "confirmed", delete_time: null });

    const cardRepo = Repository.instance<any>("gift_card");
    const cards = await cardRepo.find({ redeemed_by: account.id, status: "redeemed" });

    const bucketRepo = Repository.instance<any>("usage_bucket");
    // Use 60m granularity buckets for cost aggregation (last 90 days)
    const since = Date.now() - 90 * 86400000;
    const usageBuckets = await bucketRepo.find({ account_id: account.id, granularity: "60m", delete_time: null }, { since });

    // Group by "day|model_alias"
    const dailyModelUsage = new Map<string, { logs: any[]; maxTimestamp: number }>();
    for (const bucket of usageBuckets) {
        const day = new Date(bucket.bucket_time).toISOString().slice(0, 10);
        const model = bucket.model_alias || "Unknown";
        const key = `${day}|${model}`;
        if (!dailyModelUsage.has(key)) {
            dailyModelUsage.set(key, { logs: [], maxTimestamp: 0 });
        }
        const entry = dailyModelUsage.get(key)!;
        entry.logs.push(bucket);
        if (bucket.create_time > entry.maxTimestamp) entry.maxTimestamp = bucket.create_time;
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

    for (const [key, entry] of dailyModelUsage) {
        const model = key.split("|")[1];
        items.push(new StatementItem({
            id: `usage_${key}`,
            type: "usage",
            amount: Math.round(entry.logs.reduce((sum, b) => sum + (b.cost || 0), 0) * 1_000_000) / 1_000_000,
            description: "AI Usage",
            remark: model,
            create_time: entry.maxTimestamp,
        }));
    }

    items.sort((a, b) => b.create_time - a.create_time);

    return { list: items };
}

/**
 * Handle NowPayments IPN (Instant Payment Notification) webhook.
 * NowPayments POSTs here when payment status changes.
 */
async function ipnwebhook(request: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
    const rawBody = (request).__raw_body as string || "";
    const headers = (request).__headers as Record<string, string> || {};
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

export const subscriptionMount = {
    routes: subscriptionRoutes,
    handlers: { records, createtopup, ipnwebhook, statement },
};
