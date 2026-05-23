import { BaseEntity } from "../../lib/default/base.entity";

export interface AccountEntity extends BaseEntity {
    name: string;
    email: string;
    password: string;
    api_key: string;
    is_admin: number; // 1 = admin, 0 = regular user
    tg_chat_id: string | null;
    last_daily_time: number | null; // timestamp of last daily bonus claim
    balance: number; // persisted balance, updated atomically on mutations
}