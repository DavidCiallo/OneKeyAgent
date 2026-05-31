import { BaseEntity } from "../../lib/default/base.entity";

export type BucketGranularity = "1m" | "60m" | "1d";

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
    create_time: number;
    update_time: number;
    delete_time: number | null;
}
