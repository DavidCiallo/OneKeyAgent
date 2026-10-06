import { BaseEntity } from "../../lib/default/base.entity";

/**
 * Bucket resolutions that are actually written. There is no daily rollup: it
 * collapsed a day into one row at insert time, so any range above an hour could
 * only be drawn flat. Long ranges aggregate `60m` rows instead.
 */
export type BucketGranularity = "1m" | "60m";

export interface UsageBucketEntity extends BaseEntity {
    id: string;
    account_id: string;
    model_alias: string;
    provider_id: string;
    /** Unix ms, aligned on the stats clock (routing_timezone) to the bucket. */
    bucket_time: number;
    granularity: BucketGranularity;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    cost: number;              // pre-computed total cost
    request_count: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}
