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

/** Probability per minute for 60m flush — ~1/60 ≈ expected once per hour per key */
const SIXTY_MIN_FLUSH_PROBABILITY = 1 / 60;

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
    // Track which 1d bucket has been aggregated today
    private last1dAggregationDay: number = -1;

    private constructor() {
        for (const g of GRANULARITY_ORDER) {
            this.accumulators.set(g, new Map());
        }
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

        for (const g of GRANULARITY_ORDER) {
            if (g === "1d") {
                // 1d uses a special daily schedule
                this.scheduleDaily1dAggregation();
            } else {
                this.scheduleFlush(g);
            }
        }
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
     * Accumulates into 1m and 60m buckets simultaneously.
     * Pure memory operation — never blocks on I/O.
     */
    accumulate(data: AccumulateData): void {
        // Accumulate 1m
        const b1m = alignTime(Date.now(), 60000);
        const k1m = makeKey(b1m, data.account_id, data.model_alias, data.provider_id);
        this.mergeEntry("1m", k1m, data);

        // Accumulate 60m (align to hour boundary)
        const b60m = alignTime(Date.now(), 3_600_000);
        const k60m = makeKey(b60m, data.account_id, data.model_alias, data.provider_id);
        this.mergeEntry("60m", k60m, data);
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

    private scheduleFlush(granularity: BucketGranularity): void {
        const config = GRANULARITY_CONFIGS[granularity];
        const now = Date.now();
        const nextAligned = alignTime(now + config.intervalMs, config.intervalMs);
        const jitter = Math.random() * config.intervalMs * 0.1;
        const delay = nextAligned - now + jitter;

        const timer = setTimeout(async () => {
            try {
                await this.flush(granularity);
            } catch (err) {
                console.error(`[BucketManager] flush ${granularity} failed:`, err);
            }
            this.scheduleFlush(granularity);
        }, Math.max(delay, 1));

        this.timers.set(granularity, timer);
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

    // ── Flush ─────────────────────────────────────────────────────

    private async flush(granularity: BucketGranularity): Promise<void> {
        const acc = this.accumulators.get(granularity)!;

        // Double-buffer: swap accumulator reference atomically
        const snapshot = acc;
        this.accumulators.set(granularity, new Map());
        if (snapshot.size === 0) return;

        const config = GRANULARITY_CONFIGS[granularity];
        const now = Date.now();
        const records: any[] = [];

        for (const [key, entry] of snapshot) {
            const { bucketTime, accountId, modelAlias, providerId } = parseKey(key);

            // For 60m granularity, use probabilistic write to reduce DB load
            if (granularity === "60m" && Math.random() > SIXTY_MIN_FLUSH_PROBABILITY) {
                // Put it back in the accumulator for a future flush
                this.mergeBack("60m", key, entry);
                continue;
            }

            records.push({
                account_id: accountId,
                model_alias: modelAlias,
                provider_id: providerId,
                bucket_time: bucketTime,
                granularity,
                input_tokens: entry.input_tokens,
                output_tokens: entry.output_tokens,
                cost: Math.round(entry.cost * 1_000_000) / 1_000_000,
                request_count: entry.request_count,
            });
        }

        if (records.length > 0) {
            await this.bucketRepo.batchInsert(records);
        }
    }

    /**
     * Merge an entry back into the accumulator (used for probabilistic skip).
     * This is NOT a double-buffer swap — we merge back into the live accumulator.
     */
    private mergeBack(granularity: BucketGranularity, key: string, entry: AccumulatorEntry): void {
        const acc = this.accumulators.get(granularity)!;
        const existing = acc.get(key);
        if (existing) {
            existing.input_tokens += entry.input_tokens;
            existing.output_tokens += entry.output_tokens;
            existing.cost += entry.cost;
            existing.request_count += entry.request_count;
        } else {
            acc.set(key, { ...entry });
        }
    }

    // ── 1d Aggregation ───────────────────────────────────────────

    /**
     * Run once daily at ~00:05.
     * Aggregate all 60m records from the previous day into a single 1d record per (account, model, provider).
     */
    private async aggregate1d(): Promise<void> {
        const now = Date.now();
        const yesterdayStart = midnight(now) - 86_400_000;
        const yesterdayEnd = midnight(now);

        const buckets = await this.bucketRepo.find(
            { granularity: "60m" },
            { since: yesterdayStart },
        );

        // Filter by bucket_time and group by (account, model, provider)
        const groups = new Map<string, AccumulatorEntry>();
        for (const b of buckets) {
            if (b.bucket_time < yesterdayStart || b.bucket_time >= yesterdayEnd) continue;
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

        const records: any[] = [];
        for (const [, entry] of groups) {
            records.push({
                account_id: entry.account_id,
                model_alias: entry.model_alias,
                provider_id: entry.provider_id,
                bucket_time: yesterdayStart,
                granularity: "1d",
                input_tokens: entry.input_tokens,
                output_tokens: entry.output_tokens,
                cost: Math.round(entry.cost * 1_000_000) / 1_000_000,
                request_count: entry.request_count,
            });
        }

        if (records.length > 0) {
            await this.bucketRepo.batchInsert(records);
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────

    /**
     * Run once daily at ~00:10.
     * Deletes expired records based on granularity and bucket_time.
     */
    private async cleanup(): Promise<void> {
        const now = Date.now();
        const todayMidnight = midnight(now);

        for (const g of GRANULARITY_ORDER) {
            const config = GRANULARITY_CONFIGS[g];
            const cutoff = todayMidnight - config.ttlDays * 86_400_000;

            // Find expired records for this granularity
            const expired = await this.bucketRepo.find(
                { granularity: g },
                { since: 0 },
            );

            const expiredIds = expired
                .filter(r => r.bucket_time < cutoff)
                .map(r => r.id);

            if (expiredIds.length === 0) continue;

            // Batch delete: hardDelete one by one (JSONL rewrite per delete — same as before)
            // But we do all of them for this granularity at once
            for (const id of expiredIds) {
                await this.bucketRepo.hardDelete({ id });
            }

            if (expiredIds.length > 0) {
                console.log(`[BucketManager] cleanup ${g}: removed ${expiredIds.length} records (bucket_time < ${new Date(cutoff).toISOString()})`);
            }
        }
    }
}
