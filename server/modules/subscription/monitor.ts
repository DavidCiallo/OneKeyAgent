import { SubscriptionService } from "./subscription.service";
import { checkPaymentStatus } from "./nowpayments.service";

const SCAN_INTERVAL_MS = 60_000; // 1 minute

/**
 * Start the monitor that periodically:
 * 1. Checks pending payments with NowPayments API
 * 2. Expires stale subscriptions
 */
export function startMonitor() {
    console.log("[Monitor] Starting subscription monitor...");

    // Run immediately, then on interval
    runOnce();
    setInterval(runOnce, SCAN_INTERVAL_MS);
}

async function runOnce() {
    try {
        await checkPendingPayments();
        await SubscriptionService.expireStaleSubscriptions();
    } catch (err) {
        console.error("[Monitor] Error:", err);
    }
}

/**
 * Poll NowPayments API for pending payments that have a real payment_id.
 * When payment is confirmed, upgrade the account.
 * When expired, mark as expired.
 */
async function checkPendingPayments() {
    const pendingRecords = await SubscriptionService.findPendingRecords();
    for (const record of pendingRecords) {
        try {
            if (!record.payment_id) {
                if (Date.now() - record.create_time > 30 * 60 * 1000) {
                    await SubscriptionService.updateRecordByTxid(record.txid, { status: "expired" });
                    console.log(new Date(), `[Monitor] Payment expired for ${record.account_id} - ${record.plan_name}`);
                    continue;
                }
                continue;
            }
            const { status } = await checkPaymentStatus(record.payment_id);
            if (status === "confirmed") {
                const plan = await SubscriptionService.findPlanByName(record.plan_name);
                if (!plan) continue;

                await SubscriptionService.updateRecordByTxid(record.txid, {
                    status: "confirmed",
                    confirmations: 1,
                });
                await SubscriptionService.upgradeAccount(record.account_id, record.plan_name, plan.duration_days);
                console.log(`[Monitor] Payment confirmed for ${record.account_id} - ${record.plan_name}`);
            } else if (status === "expired") {
                await SubscriptionService.updateRecordByTxid(record.txid, { status: "expired" });
                console.log(`[Monitor] Payment expired for ${record.account_id} - ${record.plan_name}`);
            }
        } catch (err) {
            console.log(`[Monitor] Check payment ${record.payment_id} failed:`, (err as Error).message);
        }
    }
}
