import { BaseEntity } from "../../lib/default/base.entity";

export interface SubscriptionPlanEntity extends BaseEntity {
    name: string;       // "free" | "pro" | "max"
    monthly_limit: number;
    price: number;      // USDT cents (e.g., 2000 = $20)
    duration_days: number; // 30 for monthly, 0 for free
}
