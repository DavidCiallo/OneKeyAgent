import { BaseEntity } from "../../lib/default/base.entity";

export interface UsageLogEntity extends BaseEntity {
    id: string;
    apiKey: string;
    sessionId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}