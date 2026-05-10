import { BaseEntity } from "../../lib/default/base.entity";

export interface AccountEntity extends BaseEntity {
    name: string;
    email: string;
    password: string;
    apiKey: string;
    is_admin: number; // 1 = admin, 0 = regular user
    plan: string; // "free" | "pro" | "max" — defaults to "free"
    plan_expires_at: number | null;
    sub_wallet_address: string | null;
    tg_chat_id: string | null;
    topup_tokens: number; // raw tokens purchased via top-up packs, deducted after monthly limit
}