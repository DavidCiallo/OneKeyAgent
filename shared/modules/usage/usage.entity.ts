import { BaseEntity } from "../../lib/default/base.entity";

export interface UsageLogEntity extends BaseEntity {
    id: string;
    accountId: string;
    modelAlias: string;
    providerId?: string;
    inputTokens: number;
    outputTokens: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}