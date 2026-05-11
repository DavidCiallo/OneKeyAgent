import { BaseEntity } from "../../lib/default/base.entity";

export type TxStatus = "pending" | "confirmed" | "expired";
export type TxType = "topup" | "bonus" | "buy";

export interface TransactionEntity extends BaseEntity {
    account_id: string;
    txid: string;             // invoice id from NowPayments
    amount: number;           // price in USD
    confirmations: number;
    status: TxStatus;
    payment_id: string;       // NowPayments invoice ID
    type: TxType;             // "topup" | "bonus" | "buy"
}