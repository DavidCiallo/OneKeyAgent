import {
    SubscriptionPlanListRequest, SubscriptionPlanListResponse,
    SubscriptionPlanCreateRequest, SubscriptionPlanCreateResponse,
    SubscriptionPlanUpdateRequest, SubscriptionPlanUpdateResponse,
    SubscriptionPlanDeleteRequest, SubscriptionPlanDeleteResponse,
    SubscriptionPlanDTO,
} from "../../../shared/modules/subscription_plan/subscription_plan.interface";
import {
    SubscriptionRecordListRequest, SubscriptionRecordListResponse,
    SubscriptionCreatePaymentRequest, SubscriptionCreatePaymentResponse,
    SubscriptionRedeemGiftCardRequest, SubscriptionRedeemGiftCardResponse,
    SubscriptionRecordDTO,
    PaymentCurrency,
} from "../../../shared/modules/subscription_record/subscription_record.interface";
import { SubscriptionPlanRouterInstance } from "../../../shared/modules/subscription_plan/subscription_plan.router";
import { SubscriptionRecordRouterInstance } from "../../../shared/modules/subscription_record/subscription_record.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, getAccountByEmail } from "../auth/auth.service";
import { SubscriptionService } from "./subscription.service";
import { createInvoice } from "./nowpayments.service";

async function requireAdmin(auth?: string): Promise<void> {
    if (!auth) throw "Authorization failed";
    const email = getIdentifyByVerify(auth);
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account || !account.is_admin) throw "Permission denied";
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

// ─── Plan routes ───

async function planList(request: SubscriptionPlanListRequest): Promise<SubscriptionPlanListResponse> {
    request = SubscriptionPlanListRequest.self(request);
    const data = await SubscriptionService.listPlans();
    const list = data.map(item => new SubscriptionPlanDTO(item));
    return new SubscriptionPlanListResponse({
        success: true,
        message: "success",
        data: { list },
    });
}

async function planCreate(request: SubscriptionPlanCreateRequest): Promise<SubscriptionPlanCreateResponse> {
    request = SubscriptionPlanCreateRequest.self(request);
    await requireAdmin(request.auth);
    const data = await SubscriptionService.createPlan(request.plan);
    const plan = new SubscriptionPlanDTO(data);
    return new SubscriptionPlanCreateResponse({
        success: true,
        message: "success",
        data: { plan },
    });
}

async function planUpdate(request: SubscriptionPlanUpdateRequest): Promise<SubscriptionPlanUpdateResponse> {
    request = SubscriptionPlanUpdateRequest.self(request);
    await requireAdmin(request.auth);
    const data = await SubscriptionService.updatePlan(request.id, request.plan);
    if (!data) throw "Plan not found";
    const plan = new SubscriptionPlanDTO(data);
    return new SubscriptionPlanUpdateResponse({
        success: true,
        message: "success",
        data: { plan },
    });
}

async function planDelete(request: SubscriptionPlanDeleteRequest): Promise<SubscriptionPlanDeleteResponse> {
    request = SubscriptionPlanDeleteRequest.self(request);
    await requireAdmin(request.auth);
    await SubscriptionService.deletePlan(request.id);
    return new SubscriptionPlanDeleteResponse({
        success: true,
        message: "success",
    });
}

// ─── Record / Payment routes ───

async function records(request: SubscriptionRecordListRequest): Promise<SubscriptionRecordListResponse> {
    request = SubscriptionRecordListRequest.self(request);
    const account = await resolveAccount(request.auth || "");
    const data = await SubscriptionService.getRecordsByAccount(account.id);
    const list = data.map(item => new SubscriptionRecordDTO(item));
    return new SubscriptionRecordListResponse({
        success: true,
        message: "success",
        data: { list },
    });
}

/**
 * Create a NowPayments invoice for the selected plan.
 * Returns the invoice URL that the user should visit to pay.
 */
async function createpayment(request: SubscriptionCreatePaymentRequest): Promise<SubscriptionCreatePaymentResponse> {
    request = SubscriptionCreatePaymentRequest.self(request);
    console.log(request);
    const account = await resolveAccount(request.auth || "");

    // Rate limit: max 6 requests per minute per account
    if (!(await checkRateLimit(`createpayment:${account.id}`))) {
        return new SubscriptionCreatePaymentResponse({
            success: false,
            message: "Too many requests, please try again later",
            data: { invoice_url: "", payment_id: "" },
        });
    }

    if (!request.plan_name) throw new Error("plan_name is required");

    const plan = await SubscriptionService.findPlanByName(request.plan_name);
    if (!plan) throw new Error("Plan not found");
    if (plan.price <= 0) throw new Error("This plan is free");

    // Create invoice via NowPayments
    const payCurrency = (request.pay_currency as PaymentCurrency) || "USDTERC20";
    const { invoice_url, payment_id, invoice_id } = await createInvoice(
        request.plan_name,
        plan.price,
        account.id,
        payCurrency,
    );

    // Create a pending record
    await SubscriptionService.createRecord({
        account_id: account.id,
        plan_name: request.plan_name,
        txid: invoice_id,
        amount: plan.price,
        confirmations: 0,
        status: "pending",
    });

    return new SubscriptionCreatePaymentResponse({
        success: true,
        message: "success",
        data: { invoice_url, payment_id },
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
            const plan = await SubscriptionService.findPlanByName(record.plan_name);
            if (!plan) throw new Error("Plan not found");

            // Mark as confirmed
            await SubscriptionService.updateRecordByTxid(record.txid, {
                payment_id: paymentId,
                status: "confirmed",
                confirmations: 1,
            });

            // Upgrade account
            await SubscriptionService.upgradeAccount(record.account_id, record.plan_name, plan.duration_days);

            console.log(`[IPN] Account ${record.account_id} upgraded to ${record.plan_name}`);
        } else if (paymentStatus === "failed" || paymentStatus === "expired" || paymentStatus === "refunded") {
            await SubscriptionService.updateRecordByTxid(record.txid, { status: "expired" });
        }

        return { success: true, message: "ok" };
    } catch (err) {
        console.error("[IPN] Error:", err);
        return { success: false, message: String(err) };
    }
}

async function redeemgiftcard(request: SubscriptionRedeemGiftCardRequest): Promise<SubscriptionRedeemGiftCardResponse> {
    request = SubscriptionRedeemGiftCardRequest.self(request);
    const account = await resolveAccount(request.auth || "");

    // Rate limit: max 6 requests per minute per account
    if (!(await checkRateLimit(`redeemgiftcard:${account.id}`))) {
        return new SubscriptionRedeemGiftCardResponse({
            success: false,
            message: "Too many requests, please try again later",
        });
    }

    if (!request.code) {
        return new SubscriptionRedeemGiftCardResponse({
            success: false,
            message: "Gift card code is required",
        });
    }

    // For now, return a placeholder response
    // TODO: implement actual gift card redemption logic
    return new SubscriptionRedeemGiftCardResponse({
        success: false,
        message: "Gift card redemption not yet implemented",
    });
}

// ─── Export controllers ───

export const subscriptionPlanController = new SubscriptionPlanRouterInstance(inject, {
    list: planList,
    create: planCreate,
    update: planUpdate,
    delete: planDelete,
});

export const subscriptionRecordController = new SubscriptionRecordRouterInstance(inject, {
    records,
    createpayment,
    ipnwebhook,
    redeemgiftcard,
});
