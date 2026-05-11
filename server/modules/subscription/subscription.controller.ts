import {
    TransactionListRequest, TransactionListResponse,
    SubscriptionTopupRequest, SubscriptionTopupResponse,
    TransactionDTO,
    PaymentCurrency,
} from "../../../shared/modules/subscription_record/subscription_record.interface";
import { TransactionRouterInstance } from "../../../shared/modules/subscription_record/subscription_record.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, getAccountByEmail } from "../auth/auth.service";
import { SubscriptionService } from "./subscription.service";
import { createInvoice } from "./nowpayments.service";
import { AccountService } from "../account/account.service";

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

/**
 * Handle NowPayments IPN (Instant Payment Notification) webhook.
 * NowPayments POSTs here when payment status changes.
 */
async function ipnwebhook(request: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
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
            // Balance is computed from transaction records — no manual update needed

            await SubscriptionService.updateRecordByTxid(record.txid, {
                payment_id: paymentId,
                status: "confirmed",
                confirmations: 1,
            });

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
});