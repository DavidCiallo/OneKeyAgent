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
    ttlMs: number;
}

const GRANULARITY_ORDER: BucketGranularity[] = ["1m", "5m", "15m", "30m", "60m"];

const GRANULARITY_CONFIGS: Record<BucketGranularity, GranularityConfig> = {
    "1m": { granularity: "1m", intervalMs: 60000, ttlMs: 7 * 86_400_000 },       // 7 day
    "5m": { granularity: "5m", intervalMs: 300_000, ttlMs: 7 * 86_400_000 },       // 7 day
    "15m": { granularity: "15m", intervalMs: 900_000, ttlMs: 4 * 604_800_000 },      // 28 days
    "30m": { granularity: "30m", intervalMs: 1_800_000, ttlMs: 4 * 604_800_000 },     // 28 days
    "60m": { granularity: "60m", intervalMs: 3_600_000, ttlMs: 99_000_000_000_000 },
};

const CLEANUP_INTERVAL_MS = 3_600_000; // 1 hour
const HARD_DELETE_DELAY_MS = 86_400_000; // 1 day grace period after TTL expiry

function alignTime(ts: number, intervalMs: number): number {
    return Math.floor(ts / intervalMs) * intervalMs;
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

function nextGranularity(g: BucketGranularity): BucketGranularity | null {
    const idx = GRANULARITY_ORDER.indexOf(g);
    return idx < GRANULARITY_ORDER.length - 1 ? GRANULARITY_ORDER[idx + 1] : null;
}

export class BucketManager {
    private static _instance: BucketManager;

    private readonly bucketRepo = Repository.instance<UsageBucketEntity>("usage_bucket");
    private readonly accumulators = new Map<BucketGranularity, Accumulator>();
    private readonly timers = new Map<BucketGranularity, ReturnType<typeof setTimeout>>();
    private cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    private _started = false;

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
            this.scheduleFlush(g);
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
     * Pure memory operation — never blocks on I/O.
     */
    accumulate(data: AccumulateData): void {
        const bucketTime = alignTime(Date.now(), 60000);
        const key = makeKey(bucketTime, data.account_id, data.model_alias, data.provider_id);
        const acc = this.accumulators.get("1m")!;
        let entry = acc.get(key);
        if (!entry) {
            entry = { ...data, request_count: 0 };
            acc.set(key, entry);
        }
        entry.input_tokens += data.input_tokens;
        entry.output_tokens += data.output_tokens;
        entry.cost += data.cost;
        entry.request_count += 1;
    }

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

    private scheduleCleanup(): void {
        const now = Date.now();
        const nextHour = alignTime(now + CLEANUP_INTERVAL_MS, CLEANUP_INTERVAL_MS);
        const delay = nextHour - now + Math.random() * 60_000;

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

        // Double-buffer: swap accumulator reference atomically (safe in single-thread JS)
        const snapshot = acc;
        this.accumulators.set(granularity, new Map());
        if (snapshot.size === 0) return;

        const config = GRANULARITY_CONFIGS[granularity];
        const next = nextGranularity(granularity);
        const nextAcc = next ? this.accumulators.get(next) : null;
        const now = Date.now();
        const cleanTs = now + config.ttlMs;
        const records: any[] = [];

        for (const [key, entry] of snapshot) {
            const { bucketTime, accountId, modelAlias, providerId } = parseKey(key);

            // Write record at current granularity
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
                clean_timestamp: cleanTs,
            });

            // Promote to next granularity
            if (next && nextAcc) {
                const nextConfig = GRANULARITY_CONFIGS[next];
                const nextBt = alignTime(bucketTime, nextConfig.intervalMs);
                const nextKey = makeKey(nextBt, accountId, modelAlias, providerId);
                let nextEntry = nextAcc.get(nextKey);
                if (!nextEntry) {
                    nextEntry = {
                        account_id: accountId,
                        model_alias: modelAlias,
                        provider_id: providerId,
                        input_tokens: 0,
                        output_tokens: 0,
                        cost: 0,
                        request_count: 0,
                    };
                    nextAcc.set(nextKey, nextEntry);
                }
                nextEntry.input_tokens += entry.input_tokens;
                nextEntry.output_tokens += entry.output_tokens;
                nextEntry.cost += entry.cost;
                nextEntry.request_count += entry.request_count;
            }
        }

        if (records.length > 0) {
            await this.bucketRepo.batchInsert(records);
        }
    }

    /**
     * Scan for records whose TTL has expired + grace period, then physically delete them.
     */
    private async cleanup(): Promise<void> {
        const cutoff = Date.now() - HARD_DELETE_DELAY_MS;
        const expired = await this.bucketRepo.find({}, {});
        const expiredIds = expired
            .filter(r => r.clean_timestamp && r.clean_timestamp < cutoff)
            .map(r => r.id);

        for (const id of expiredIds) {
            await this.bucketRepo.hardDelete({ id });
        }
    }
}
