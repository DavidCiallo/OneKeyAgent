import { checkPaymentStatus } from "./nowpayments.service";
import { SubscriptionService } from "./subscription.service";
import { AccountService } from "../account/account.service";

const SCAN_INTERVAL_MS = 60_000; // 1 minute

/**
 * Start the monitor that periodically checks pending payments with NowPayments API.
 */
export function startMonitor() {
    console.log("[Monitor] Starting payment monitor...");

    // Run immediately, then on interval
    runOnce();
    setInterval(runOnce, SCAN_INTERVAL_MS);
}

async function runOnce() {
    try {
        await checkPendingPayments();
    } catch (err) {
        console.error("[Monitor] Error:", err);
    }
}

/**
 * Poll NowPayments API for pending payments that have a real payment_id.
 * When payment is confirmed, mark as confirmed.
 * When expired, mark as expired.
 */
async function checkPendingPayments() {
    const pendingRecords = await SubscriptionService.findPendingRecords();
    for (const record of pendingRecords) {
        try {
            if (!record.payment_id) {
                if (Date.now() - record.create_time > 30 * 60 * 1000) {
                    await SubscriptionService.updateRecordByTxid(record.txid, { status: "expired" });
                    console.log(new Date(), `[Monitor] Payment expired for ${record.account_id}`);
                    continue;
                }
                continue;
            }
            const { status } = await checkPaymentStatus(record.payment_id);
            if (status === "confirmed") {
                // Balance is computed from transaction records — no manual update needed

                await SubscriptionService.updateRecordByTxid(record.txid, {
                    status: "confirmed",
                    confirmations: 1,
                });
                console.log(`[Monitor] Payment confirmed for ${record.account_id}`);
            } else if (status === "expired") {
                await SubscriptionService.updateRecordByTxid(record.txid, { status: "expired" });
                console.log(`[Monitor] Payment expired for ${record.account_id}`);
            }
        } catch (err) {
            console.log(`[Monitor] Check payment ${record.payment_id} failed:`, (err as Error).message);
        }
    }
}