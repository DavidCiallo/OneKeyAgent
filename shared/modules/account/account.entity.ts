import { BaseEntity } from "../../lib/default/base.entity";

export type AccountRole = "admin" | "user";

export interface AccountEntity extends BaseEntity {
    name: string;
    email: string;
    password: string;
    apiKey: string; // API Key for AI service
    role: AccountRole;
}