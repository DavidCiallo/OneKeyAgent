import Repository from "../../lib/repository";
import { SubscriptionPlanEntity } from "../../../shared/modules/subscription_plan/subscription_plan.entity";
import { SubscriptionRecordEntity } from "../../../shared/modules/subscription_record/subscription_record.entity";
import { AccountService } from "../account/account.service";

const planRepo = Repository.instance<SubscriptionPlanEntity>("SubscriptionPlan");
const recordRepo = Repository.instance<SubscriptionRecordEntity>("SubscriptionRecord");

export class SubscriptionService {

    // ─── Plan management ───

    static async listPlans(): Promise<SubscriptionPlanEntity[]> {
        return await planRepo.find({ delete_time: null });
    }

    static async findPlanByName(name: string): Promise<SubscriptionPlanEntity | null> {
        return await planRepo.findOne({ name, delete_time: null });
    }

    static async createPlan(data: Partial<SubscriptionPlanEntity>): Promise<SubscriptionPlanEntity> {
        return await planRepo.insert(data);
    }

    static async updatePlan(id: string, data: Partial<SubscriptionPlanEntity>): Promise<SubscriptionPlanEntity | null> {
        await planRepo.update({ id }, data);
        return await planRepo.findOne({ id });
    }

    static async deletePlan(id: string): Promise<void> {
        await planRepo.delete({ id });
    }

    // ─── Record management ───

    static async getRecordsByAccount(accountId: string): Promise<SubscriptionRecordEntity[]> {
        return await recordRepo.find({ account_id: accountId, delete_time: null });
    }

    static async createRecord(data: Partial<SubscriptionRecordEntity>): Promise<SubscriptionRecordEntity> {
        return await recordRepo.insert(data);
    }

    static async updateRecordByTxid(txid: string, data: Partial<SubscriptionRecordEntity>): Promise<void> {
        await recordRepo.update({ txid }, data);
    }

    static async findPendingRecords(): Promise<SubscriptionRecordEntity[]> {
        return await recordRepo.find({ status: "pending", delete_time: null });
    }

    // ─── Subscription upgrade ───

    /**
     * Upgrade an account to a paid plan and set expiry.
     * If already on the same plan, extend the expiry.
     */
    static async upgradeAccount(accountId: string, planName: string, durationDays: number): Promise<void> {
        const account = await AccountService.findOne(accountId);
        if (!account) throw new Error("Account not found");

        const plan = await this.findPlanByName(planName);
        if (!plan) throw new Error(`Plan '${planName}' not found`);

        const now = Date.now();
        let expiresAt: number;

        if (account.plan === planName && account.plan_expires_at && account.plan_expires_at > now) {
            // Extend existing subscription
            expiresAt = account.plan_expires_at + durationDays * 86400000;
        } else {
            // New subscription
            expiresAt = now + durationDays * 86400000;
        }

        await AccountService.update(accountId, {
            plan: planName,
            monthly_limit: plan.monthly_limit,
            plan_expires_at: expiresAt,
        });
    }

    /**
     * Check and downgrade expired subscriptions.
     * Called periodically by the monitor.
     */
    static async expireStaleSubscriptions(): Promise<void> {
        const freePlan = await this.findPlanByName("free");
        if (!freePlan) return;

        const now = Date.now();
        const allAccounts = await AccountService.findAll();

        for (const account of allAccounts) {
            if (account.plan === "free") continue;
            if (account.plan_expires_at && account.plan_expires_at < now) {
                await AccountService.update(account.id, {
                    plan: "free",
                    monthly_limit: freePlan.monthly_limit,
                    plan_expires_at: null,
                });
                console.log(`[Subscription] Account ${account.email} plan expired, downgraded to free`);
            }
        }
    }
}
