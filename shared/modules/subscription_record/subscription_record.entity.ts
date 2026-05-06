import { BaseEntity } from "../../lib/default/base.entity";

export type TxStatus = "pending" | "confirmed" | "expired";
export type ChainType = "trc20" | "erc20" | "bep20";

export interface SubscriptionRecordEntity extends BaseEntity {
    account_id: string;
    plan_name: string;        // which plan was purchased
    txid: string;             // transaction hash (unique)
    from_address: string;     // sender wallet address
    to_address: string;       // receiver wallet address
    chain: ChainType;
    amount: number;           // USDT cents
    confirmations: number;
    status: TxStatus;
}
