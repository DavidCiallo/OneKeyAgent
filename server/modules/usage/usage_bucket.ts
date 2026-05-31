import Repository from "../../lib/repository";
import { UsageBucketEntity, BucketGranularity } from "../../../shared/modules/usage/usage_bucket.entity";

interface AccumulateData {
    account_id: string;
    model_alias: string;
    provider_id: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
}

interface AccumulatorEntry {
    account_id: string;
    model_alias: string;
    provider_id: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
    request_count: number;
}

type Accumulator = Map<string, AccumulatorEntry>;

// ── Constants ────────────────────────────────────────────────────

interface GranularityConfig {
    granularity: BucketGranularity;
    intervalMs: number;
    ttlDays: number;
}

const GRANULARITY_ORDER: BucketGranularity[] = ["1m", "60m", "1d"];

const GRANULARITY_CONFIGS: Record<BucketGranularity, GranularityConfig> = {
    "1m": { granularity: "1m", intervalMs: 60000, ttlDays: 7 },
    "60m": { granularity: "60m", intervalMs: 3_600_000, ttlDays: 90 },
    "1d": { granularity: "1d", intervalMs: 86_400_000, ttlDays: 730 }, // 2 years
};

function alignTime(ts: number, intervalMs: number): number {
    return Math.floor(ts / intervalMs) * intervalMs;
}

function midnight(ts: number): number {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function makeKey(bucketTime: number, accountId: string, modelAlias: string, providerId: string): string {
    return `${bucketTime}|${accountId}|${modelAlias}|${providerId}`;
}

function parseKey(key: string): { bucketTime: number; accountId: string; modelAlias: string; providerId: string } {
    const parts = key.split("|");
    return {
        bucketTime: parseInt(parts[0], 10),
        accountId: parts[1],
        modelAlias: parts[2],
        providerId: parts.slice(3).join("|"),
    };
}

export class BucketManager {
    private static _instance: BucketManager;

    private readonly bucketRepo = Repository.instance<UsageBucketEntity>("usage_bucket");

    // Accumulators: one per granularity
    private readonly accumulators = new Map<BucketGranularity, Accumulator>();
    private readonly timers = new Map<BucketGranularity, ReturnType<typeof setTimeout>>();
    private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    private _started = false;
    private last1dAggregationDay: number = -1;

    private constructor() {
        this.accumulators.set("1m", new Map());
    }

    static get instance(): BucketManager {
        if (!BucketManager._instance) {
            BucketManager._instance = new BucketManager();
        }
        return BucketManager._instance;
    }

    get started(): boolean {
        return this._started;
    }

    /** Start all flush timers and the cleanup timer. Call once on server startup. */
    start(): void {
        if (this._started) return;
        this._started = true;

        this.scheduleFlush();
        this.scheduleDaily1dAggregation();
        this.scheduleCleanup();
    }

    /** Stop all timers for graceful shutdown. */
    stop(): void {
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
        if (this.cleanupTimer) {
            clearTimeout(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this._started = false;
    }

    /**
     * Called by logUsage() on every request.
     * Accumulates into 1m bucket only. Pure memory operation — never blocks on I/O.
     * 60m rows are upserted during 1m flush.
     */
    accumulate(data: AccumulateData): void {
        const b1m = alignTime(Date.now(), 60000);
        const k1m = makeKey(b1m, data.account_id, data.model_alias, data.provider_id);
        this.mergeEntry("1m", k1m, data);
    }

    private mergeEntry(granularity: BucketGranularity, key: string, data: AccumulateData): void {
        const acc = this.accumulators.get(granularity)!;
        let entry = acc.get(key);
        if (!entry) {
            entry = {
                account_id: data.account_id,
                model_alias: data.model_alias,
                provider_id: data.provider_id,
                input_tokens: 0,
                output_tokens: 0,
                cost: 0,
                request_count: 0,
            };
            acc.set(key, entry);
        }
        entry.input_tokens += data.input_tokens;
        entry.output_tokens += data.output_tokens;
        entry.cost += data.cost;
        entry.request_count += 1;
    }

    // ── Timer scheduling ─────────────────────────────────────────

    private scheduleFlush(): void {
        const now = Date.now();
        const nextAligned = alignTime(now + 60000, 60000);
        const jitter = Math.random() * 6000; // up to 6s jitter
        const delay = Math.max(nextAligned - now + jitter, 1);

        const timer = setTimeout(async () => {
            try {
                await this.flush();
            } catch (err) {
                console.error("[BucketManager] flush failed:", err);
            }
            this.scheduleFlush();
        }, delay);

        this.timers.set("1m", timer);
    }

    /**
     * 1d aggregation runs once daily at ~00:05.
     * It aggregates all 60m records from the previous day into a single 1d record.
     */
    private scheduleDaily1dAggregation(): void {
        const now = Date.now();
        const todayMidnight = midnight(now);
        // Schedule for 5 minutes after next midnight
        const nextRun = todayMidnight + 86_400_000 + 300_000;
        const delay = Math.max(nextRun - now, 1);

        const timer = setTimeout(async () => {
            try {
                await this.aggregate1d();
            } catch (err) {
                console.error("[BucketManager] 1d aggregation failed:", err);
            }
            this.scheduleDaily1dAggregation();
        }, delay);

        this.timers.set("1d", timer);
    }

    private scheduleCleanup(): void {
        const now = Date.now();
        const nextMidnight = midnight(now) + 86_400_000 + 600_000; // 00:10 daily
        const delay = Math.max(nextMidnight - now, 60_000);

        this.cleanupTimer = setTimeout(async () => {
            try {
                await this.cleanup();
            } catch (err) {
                console.error("[BucketManager] cleanup failed:", err);
            }
            this.scheduleCleanup();
        }, Math.max(delay, 1));
    }

    /**
     * Flush the 1m accumulator every minute.
     * Writes 1m rows to DB, then upserts into 60m by business key
     * (granularity + bucket_time + account_id + model_alias + provider_id).
     */
    private async flush(): Promise<void> {
        const acc = this.accumulators.get("1m")!;

        // Double-buffer: swap accumulator reference atomically
        const snapshot = acc;
        this.accumulators.set("1m", new Map());
        if (snapshot.size === 0) return;

        // Track which 60m keys we've upserted during this flush
        // Map: 60m_key → AccumulatorEntry (monotonically increasing accumulator)
        const sixtyMinAcc = new Map<string, AccumulatorEntry>();

        for (const [key, entry] of snapshot) {
            const { bucketTime, accountId, modelAlias, providerId } = parseKey(key);
            const cost = Math.round(entry.cost * 1_000_000) / 1_000_000;

            // 1. Insert 1m row
            await this.bucketRepo.insert({
                account_id: accountId,
                model_alias: modelAlias,
                provider_id: providerId,
                bucket_time: bucketTime,
                granularity: "1m" as BucketGranularity,
                input_tokens: entry.input_tokens,
                output_tokens: entry.output_tokens,
                cost,
                request_count: entry.request_count,
            });

            // 2. Accumulate into in-memory 60m grouping (dedup by hour-aligned key)
            const b60m = alignTime(bucketTime, 3_600_000);
            const k60m = makeKey(b60m, accountId, modelAlias, providerId);
            let acc60 = sixtyMinAcc.get(k60m);
            if (!acc60) {
                acc60 = {
                    account_id: accountId,
                    model_alias: modelAlias,
                    provider_id: providerId,
                    input_tokens: 0,
                    output_tokens: 0,
                    cost: 0,
                    request_count: 0,
                };
                sixtyMinAcc.set(k60m, acc60);
            }
            acc60.input_tokens += entry.input_tokens;
            acc60.output_tokens += entry.output_tokens;
            acc60.cost += entry.cost;
            acc60.request_count += entry.request_count;
        }

        // 3. Upsert each 60m bucket into DB (by business key)
        for (const [k60m, acc60] of sixtyMinAcc) {
            const { bucketTime: b60m, accountId, modelAlias, providerId } = parseKey(k60m);
            const cost60 = Math.round(acc60.cost * 1_000_000) / 1_000_000;

            const existing = await this.bucketRepo.findOne({
                granularity: "60m" as BucketGranularity,
                bucket_time: b60m,
                account_id: accountId,
                model_alias: modelAlias,
                provider_id: providerId,
            }, true);
            if (existing) {
                await this.bucketRepo.update({ id: existing.id }, {
                    input_tokens: (existing.input_tokens || 0) + acc60.input_tokens,
                    output_tokens: (existing.output_tokens || 0) + acc60.output_tokens,
                    cost: Math.round(((existing.cost || 0) + acc60.cost) * 1_000_000) / 1_000_000,
                    request_count: (existing.request_count || 0) + acc60.request_count,
                });
            } else {
                await this.bucketRepo.insert({
                    account_id: accountId,
                    model_alias: modelAlias,
                    provider_id: providerId,
                    bucket_time: b60m,
                    granularity: "60m" as BucketGranularity,
                    input_tokens: acc60.input_tokens,
                    output_tokens: acc60.output_tokens,
                    cost: cost60,
                    request_count: acc60.request_count,
                });
            }
        }
    }

    /**
     * Run once daily at ~00:05.
     * Aggregate all 60m records from the previous day into a single 1d record per (account, model, provider).
     * Idempotent: if a 1d record already exists for the same day+key, it updates instead of inserting.
     */
    private async aggregate1d(): Promise<void> {
        const now = Date.now();
        const yesterdayStart = midnight(now) - 86_400_000;
        const yesterdayEnd = midnight(now);

        // Guard: skip if already aggregated today (after restart etc.)
        const todayKey = midnight(now);
        if (this.last1dAggregationDay === todayKey) return;
        this.last1dAggregationDay = todayKey;

        const buckets = await this.bucketRepo.find({
            granularity: "60m",
            bucket_time: { $gte: yesterdayStart, $lt: yesterdayEnd },
        });

        // Group by (account, model, provider)
        const groups = new Map<string, AccumulatorEntry>();
        for (const b of buckets) {
            const key = `${b.account_id}|${b.model_alias}|${b.provider_id}`;
            let entry = groups.get(key);
            if (!entry) {
                entry = {
                    account_id: b.account_id,
                    model_alias: b.model_alias,
                    provider_id: b.provider_id,
                    input_tokens: 0,
                    output_tokens: 0,
                    cost: 0,
                    request_count: 0,
                };
                groups.set(key, entry);
            }
            entry.input_tokens += b.input_tokens || 0;
            entry.output_tokens += b.output_tokens || 0;
            entry.cost += b.cost || 0;
            entry.request_count += b.request_count || 0;
        }

        if (groups.size === 0) return;

        for (const [, entry] of groups) {
            const cost = Math.round(entry.cost * 1_000_000) / 1_000_000;
            // Stable ID: hard-delete old row then insert fresh, ensures exactly one row per key
            const id = `${yesterdayStart}|${entry.account_id}|${entry.model_alias}|${entry.provider_id}`;

            await this.bucketRepo.hardDelete({ id });
            await this.bucketRepo.insert({
                id,
                account_id: entry.account_id,
                model_alias: entry.model_alias,
                provider_id: entry.provider_id,
                bucket_time: yesterdayStart,
                granularity: "1d" as BucketGranularity,
                input_tokens: entry.input_tokens,
                output_tokens: entry.output_tokens,
                cost,
                request_count: entry.request_count,
            });
        }
    }

    private async cleanup(): Promise<void> {
        const now = Date.now();
        const todayMidnight = midnight(now);

        for (const g of GRANULARITY_ORDER) {
            const config = GRANULARITY_CONFIGS[g];
            const cutoff = todayMidnight - config.ttlDays * 86_400_000;

            const expired = await this.bucketRepo.find({
                granularity: g,
                bucket_time: { $lt: cutoff },
            });
            const expiredIds = expired.map(r => r.id);

            if (expiredIds.length === 0) continue;

            for (const id of expiredIds) {
                await this.bucketRepo.hardDelete({ id });
            }
        }
    }
}
