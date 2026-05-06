import Repository from "../../lib/repository";
import { SubscriptionPlanEntity } from "../../../shared/modules/subscription_plan/subscription_plan.entity";

const planRepo = Repository.instance<SubscriptionPlanEntity>("SubscriptionPlan");

const DEFAULT_PLANS = [
    { name: "free", monthly_limit: 60_000_000, price: 0, duration_days: 0 },
    { name: "base", monthly_limit: 240_000_000, price: 200, duration_days: 30 },
    { name: "pro", monthly_limit: 1500_000_000, price: 1000, duration_days: 30 },
    { name: "max", monthly_limit: 3600_000_000, price: 2000, duration_days: 30 },
];

export async function seedDefaultPlans() {
    const existing = await planRepo.find({ delete_time: null });

    for (const plan of DEFAULT_PLANS) {
        const hasPlan = existing.some(p => p.name === plan.name);
        if (!hasPlan) {
            await planRepo.insert(plan);
            console.log(`[Seed] Created subscription plan '${plan.name}'`);
        }
    }
}
