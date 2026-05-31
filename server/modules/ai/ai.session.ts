import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { UsageBucketEntity, BucketGranularity } from "../../../shared/modules/usage/usage_bucket.entity";

const modelRepo = Repository.instance<ModelEntity>("Model");
const bucketRepo = Repository.instance<UsageBucketEntity>("usage_bucket");

const TTL_MS: Record<BucketGranularity, number> = {
    "1m": 7 * 86400000,
    "60m": 90 * 86400000,
    "1d": 730 * 86400000,
};

function midnight(ts: number): number {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

async function upsertBucket(
    bucketTime: number,
    granularity: BucketGranularity,
    account_id: string,
    model_alias: string,
    provider_id: string,
    input_tokens: number,
    output_tokens: number,
    cost: number,
): Promise<void> {
    const existing = await bucketRepo.findOne(
        { account_id, model_alias, provider_id, granularity },
        true, // reverse scan — finds the most recent record first
    );

    if (existing && existing.bucket_time === bucketTime) {
        // Same window — accumulate into existing row
        await bucketRepo.atomicPatch(
            { id: existing.id },
            (row) => ({
                input_tokens: (row!.input_tokens || 0) + input_tokens,
                output_tokens: (row!.output_tokens || 0) + output_tokens,
                cost: Math.round(((row!.cost || 0) + cost) * 1_000_000) / 1_000_000,
                request_count: (row!.request_count || 0) + 1,
            }),
        );
    } else {
        // New window — insert fresh row
        await bucketRepo.insert({
            account_id,
            model_alias,
            provider_id,
            bucket_time: bucketTime,
            granularity,
            input_tokens,
            output_tokens,
            cost: Math.round(cost * 1_000_000) / 1_000_000,
            request_count: 1,
        });
    }
}

/** Delete the oldest expired bucket row for a granularity (distributed cleanup, no batch pressure) */
async function cleanupExpired(granularity: BucketGranularity): Promise<void> {
    const cutoff = Date.now() - TTL_MS[granularity];
    const oldest = await bucketRepo.findOne({ granularity }, false);
    if (oldest && oldest.bucket_time < cutoff) {
        await bucketRepo.hardDelete({ id: oldest.id });
    }
}

export async function logUsage(usage: {
    account_id: string,
    model_alias: string,
    provider_id?: string,
    input_tokens: number,
    output_tokens: number,
    input_price: number,
    output_price: number,
}) {
    const cost = Math.round((usage.input_tokens * (usage.input_price || 0) + usage.output_tokens * (usage.output_price || 0)) / 1_000_000 * 1_000_000) / 1_000_000;
    const now = Date.now();
    const provider = usage.provider_id || "unknown";

    const b1m = Math.floor(now / 60_000) * 60_000;
    const b60m = Math.floor(now / 3_600_000) * 3_600_000;
    const b1d = midnight(now);

    await Promise.all([
        upsertBucket(b1m, "1m", usage.account_id, usage.model_alias, provider, usage.input_tokens, usage.output_tokens, cost),
        upsertBucket(b60m, "60m", usage.account_id, usage.model_alias, provider, usage.input_tokens, usage.output_tokens, cost),
        upsertBucket(b1d, "1d", usage.account_id, usage.model_alias, provider, usage.input_tokens, usage.output_tokens, cost),
    ]);

    // Distributed cleanup: delete oldest expired row per granularity
    await cleanupExpired("1m");
    await cleanupExpired("60m");
    await cleanupExpired("1d");
}

export async function getAllModels(): Promise<ModelEntity[]> {
    const list = await modelRepo.find({ delete_time: null });
    return list.sort((a, b) => a.alias.localeCompare(b.alias));
}

export async function getModelById(id: string): Promise<ModelEntity | null> {
    return await modelRepo.findOne({ id });
}

export async function getModelsByAlias(name: string): Promise<ModelEntity[]> {
    const all = await getAllModels();
    return all.filter(m => m.alias === name);
}
