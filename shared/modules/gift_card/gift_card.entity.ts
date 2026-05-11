import { BaseEntity } from "../../lib/default/base.entity";

export type GiftCardStatus = "unused" | "redeemed" | "expired";

export interface GiftCardEntity extends BaseEntity {
    code: string;
    token_amount: number;
    status: GiftCardStatus;
    redeemed_by: string | null;
    redeemed_at: number | null;
}