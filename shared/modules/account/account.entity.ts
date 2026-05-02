import { BaseEntity } from "../../lib/default/base.entity";

export interface AccountEntity extends BaseEntity {
    name: string;
    email: string;
    password: string;
    apiKey: string;
    is_admin: number; // 1 = admin, 0 = regular user
    monthly_limit: number;
    tg_chat_id: string | null;
}