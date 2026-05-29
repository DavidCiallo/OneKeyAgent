import { BaseEntity } from "../../lib/default/base.entity";

export type BucketGranularity = "1m" | "5m" | "15m" | "30m" | "60m";

export interface UsageBucketEntity extends BaseEntity {
    id: string;
    account_id: string;
    model_alias: string;
    provider_id: string;
    bucket_time: number;       // unix timestamp aligned to granularity boundary
    granularity: BucketGranularity;
    input_tokens: number;
    output_tokens: number;
    cost: number;              // pre-computed total cost
    request_count: number;
    clean_timestamp: number;   // records with clean_timestamp < now will be cleaned
    create_time: number;
    update_time: number;
    delete_time: number | null;
}
