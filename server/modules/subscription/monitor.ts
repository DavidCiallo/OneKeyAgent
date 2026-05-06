import { SubscriptionService } from "./subscription.service";
import { AccountService } from "../account/account.service";
import { SubscriptionPlanEntity } from "../../../shared/modules/subscription_plan/subscription_plan.entity";

const SCAN_INTERVAL_MS = 60_000; // 1 minute
const REQUIRED_CONFIRMATIONS = 6;
const MIN_AMOUNT_CENTS = 0; // minimum USDT cents to accept (0 = accept any)

/**
 * Start the chain monitor that periodically:
 * 1. Checks for expired subscriptions and downgrades them
 * 2. Scans Trongrid for incoming USDT transactions
 */
export function startMonitor() {
    console.log("[Monitor] Starting subscription chain monitor...");

    // Run immediately, then on interval
    runOnce();
    setInterval(runOnce, SCAN_INTERVAL_MS);
}

async function runOnce() {
    try {
        // 1. Expire stale subscriptions
        await SubscriptionService.expireStaleSubscriptions();

        // 2. Scan for incoming TRC-20 USDT transactions
        await scanIncoming();
    } catch (err) {
        console.error("[Monitor] Error:", err);
    }
}

interface TrongridTrc20Transfer {
    transaction_id: string;
    from: string;
    to: string;
    value: string;
    block_timestamp: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    token_info?: any;
}

interface TrongridResponse {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta?: any;
}

async function scanIncoming() {
    const masterAddress = process.env.TRC20_WALLET_ADDRESS;
    if (!masterAddress) return; // not configured

    try {
        const url = `https://api.trongrid.io/v1/accounts/${masterAddress}/transactions/trc20?only_to=true&limit=50&contract_address=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t&min_timestamp=${Date.now() - 86400000}`;
        const resp = await fetch(url);
        const json: TrongridResponse = await resp.json();

        if (!json.data || !Array.isArray(json.data)) return;

        const usdtDecimals = 6; // TRC-20 USDT has 6 decimals

        for (const tx of json.data as TrongridTrc20Transfer[]) {
            const txid = tx.transaction_id;
            const fromAddress = tx.from;
            const toAddress = tx.to;
            const rawValue = tx.value || "0";
            const amountCents = Math.floor(parseInt(rawValue) / 10 ** (usdtDecimals - 2)); // convert to cents

            // Skip if already recorded
            const existing = await SubscriptionService.findPendingRecords();
            if (existing.some(r => r.txid === txid)) continue;

            if (amountCents < MIN_AMOUNT_CENTS) continue;

            // Find which account this belongs to by checking sub_wallet_address
            // For the shared-address model, we need to match by amount + plan price
            // For now, match by finding the plan whose price matches the amount
            const plans = await SubscriptionService.listPlans();
            const matchedPlan = plans.find(p => p.price > 0 && Math.abs(p.price - amountCents) < 100); // within $1 tolerance
            if (!matchedPlan) continue;

            // Create pending record
            await SubscriptionService.createRecord({
                account_id: "unknown", // will be resolved when we implement per-user addresses
                plan_name: matchedPlan.name,
                txid,
                from_address: fromAddress,
                to_address: toAddress,
                chain: "trc20",
                amount: amountCents,
                confirmations: 1,
                status: "pending",
            });

            console.log(`[Monitor] New pending tx: ${txid} amount=${amountCents} cents`);
        }
    } catch (err) {
        console.error("[Monitor] Trongrid scan failed:", err);
    }
}

/**
 * Confirm a pending record manually (admin operation).
 * In production this would check block confirmations.
 */
export async function confirmSubscription(txid: string): Promise<void> {
    const records = await SubscriptionService.findPendingRecords();
    const record = records.find(r => r.txid === txid);
    if (!record) throw new Error("Record not found or already confirmed");

    // Find the account by sub_wallet_address match
    const account = await AccountService.findBySubWalletAddress(record.to_address);
    if (!account) throw new Error("No account matches this deposit address");

    const plan = await SubscriptionService.findPlanByName(record.plan_name);
    if (!plan) throw new Error("Plan not found");

    // Mark as confirmed
    await SubscriptionService.updateRecordByTxid(txid, {
        account_id: account.id,
        confirmations: REQUIRED_CONFIRMATIONS,
        status: "confirmed",
    });

    // Upgrade account
    await SubscriptionService.upgradeAccount(account.id, record.plan_name, plan.duration_days);

    console.log(`[Monitor] Account ${account.email} upgraded to ${record.plan_name}`);
}
