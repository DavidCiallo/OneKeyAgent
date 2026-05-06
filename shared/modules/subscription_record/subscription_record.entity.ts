import { BaseEntity } from "../../lib/default/base.entity";

export type TxStatus = "pending" | "confirmed" | "expired";

export interface SubscriptionRecordEntity extends BaseEntity {
    account_id: string;
    plan_name: string;        // which plan was purchased
    txid: string;             // invoice id from NowPayments
    amount: number;           // price in cents
    confirmations: number;
    status: TxStatus;
    payment_id: string;       // NowPayments invoice ID
}
