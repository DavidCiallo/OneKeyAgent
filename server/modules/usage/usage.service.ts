import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";
import { UsageBucketEntity } from "../../../shared/modules/usage/usage_bucket.entity";
import { UsageStatsPeriod, UsageStatsResult, UsageAmountData, UserSession, UserSessionGroup, ProviderUsage, ModelUsage } from "../../../shared/modules/usage/usage.interface";

const bucketRepo = Repository.instance<UsageBucketEntity>("usage_bucket");
const modelRepo = Repository.instance<ModelEntity>("Model");
const providerRepo = Repository.instance<ProviderEntity>("Provider");
const accountRepository = Repository.instance<AccountEntity>("Account");

const TEN_MIN = 10 * 60 * 1000;
const DAY = 86400000;
const MONTH = 30 * DAY;

/** Get the local-timezone midnight timestamp (in ms since epoch) */
function localDayStart(ts: number): number {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Return how many 10-min display slots a bucket granularity spans */
function bucketSlots(granularity: string): number {
    switch (granularity) {
        case "minute": case "1m": return 1;
        case "hour": case "60m": return 6;
        case "1d": return 144; // 144 * 10min = 24h
        default: return 1;
    }
}

/** Build a cumulative usage period from pre-aggregated bucket records. */
function buildBucketPeriod(buckets: any[], periodStart: number, periodEnd: number): UsageStatsPeriod {
    // Pre-generate all 10-min buckets in the period
    const bucketMap = new Map<number, number>();
    for (let t = periodStart; t < periodEnd; t += TEN_MIN) {
        bucketMap.set(t, 0);
    }

    for (const bucket of buckets) {
        const bt = bucket.bucket_time;
        const tokens = (bucket.input_tokens || 0) + (bucket.output_tokens || 0);
        const slots = bucketSlots(bucket.granularity);
        const tokensPerSlot = tokens / slots;

        for (let i = 0; i < slots; i++) {
            const slot = bt + i * TEN_MIN;
            if (slot >= periodStart && slot < periodEnd) {
                bucketMap.set(slot, (bucketMap.get(slot) || 0) + tokensPerSlot);
            }
        }
    }

    const amounts: UsageAmountData[] = [];
    let cumulative = 0;
    const sortedBuckets = [...bucketMap.entries()].sort(([a], [b]) => a - b);

    for (const [ts, bucketAmount] of sortedBuckets) {
        cumulative += bucketAmount;
        const amount = Math.round(cumulative / 1_000_000 * 100) / 100;
        if (amounts.length === 0 || amounts[amounts.length - 1].amount !== amount) {
            amounts.push({ ts, amount });
        }
    }

    if (amounts.length === 0 && sortedBuckets.length > 0) {
        amounts.push({ ts: sortedBuckets[0][0], amount: 0 });
    }

    const total = amounts.length > 0 ? amounts[amounts.length - 1].amount : 0;
    return { total, amounts };
}

export class UsageService {
    static async find(page: number, filter: { account_id?: string; model_alias?: string }, since?: number): Promise<{ list: UsageBucketEntity[], total: number }> {
        // 30-day window → use 60m granularity (1m data only kept 7 days)
        const bucketFilter: any = { ...filter, granularity: "60m" };
        const list = await bucketRepo.find(bucketFilter, { offset: (page - 1) * 40, limit: 40, since });
        const total = since ? await bucketRepo.count(bucketFilter, since) : await bucketRepo.count(bucketFilter);
        return { list, total };
    }

    static async stats(model_alias?: string, account_id?: string): Promise<UsageStatsResult> {
        const now = Date.now();

        const todayStart = localDayStart(now);
        const last24hStart = now - DAY;
        const weekStart = now - 7 * DAY;

        const baseFilter: any = {};
        if (model_alias) baseFilter.model_alias = model_alias;
        if (account_id) baseFilter.account_id = account_id;

        // Use 1m for fine-grained short ranges, 1d for weekly overview
        const [todayBuckets, last24hBuckets, weekBuckets] = await Promise.all([
            UsageService.loadBucketsByTime(baseFilter, todayStart, "1m"),
            UsageService.loadBucketsByTime(baseFilter, last24hStart, "1m"),
            UsageService.loadBucketsByTime(baseFilter, weekStart, "1d"),
        ]);

        return {
            today: buildBucketPeriod(todayBuckets, todayStart, now),
            last24h: buildBucketPeriod(last24hBuckets, last24hStart, now),
            last7Days: buildBucketPeriod(weekBuckets, weekStart, now),
        };
    }

    /** Load bucket records at a given granularity since a time, filtering by bucket_time for accuracy */
    private static async loadBucketsByTime(filter: any, since: number, granularity: string): Promise<any[]> {
        const bufferMs = 7_200_000; // 2 hour safety margin for create_time vs bucket_time skew
        const buckets = await bucketRepo.find(
            { ...filter, granularity },
            { since: since - bufferMs }
        );
        return buckets.filter((b: any) => b.bucket_time >= since);
    }

    /** Pick the coarsest granularity that still provides adequate precision for the query */
    private static selectGranularity(gapMinutes: number, since: number): string {
        const rangeDays = (Date.now() - since) / DAY;
        if (rangeDays <= 1) return "1m";          // up to 1 day → 1m precision
        if (rangeDays <= 90) return "60m";         // up to 90 days → hourly precision
        return "1d";                                // beyond 90 days → daily
    }

    static windowStart(ts: number, gapMs: number): number {
        const localMidnight = localDayStart(ts);
        const offset = ts - localMidnight;
        const rounded = Math.floor(offset / gapMs) * gapMs;
        return localMidnight + rounded;
    }

    static formatWindowLabel(ts: number, gapMs: number): string {
        const d = new Date(ts);
        const MM = String(d.getMonth() + 1).padStart(2, "0");
        const DD = String(d.getDate()).padStart(2, "0");
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const end = new Date(ts + gapMs);
        const ehh = String(end.getHours()).padStart(2, "0");
        const emm = String(end.getMinutes()).padStart(2, "0");

        if (gapMs >= 86400000) {
            // 1d: just show the date
            return `${MM}/${DD}`;
        }
        if (gapMs >= 3600000) {
            // >= 1h: show as hh:00-hh:00
            return `${MM}/${DD} ${hh}:00-${ehh}:00`;
        }
        // < 1h (1m, 15min, 30min): show as hh:mm-hh:mm
        return `${MM}/${DD} ${hh}:${mm}-${ehh}:${emm}`;
    }

    static async getUserSessions(gapMinutes?: number, since?: number, account_ids?: string[], isAdmin?: boolean): Promise<{ groups: UserSessionGroup[]; totals: { totalTokens: number; totalCost: number; totalRequests: number } }> {
        const now = Date.now();
        const effectiveSince = since ?? now - 7 * DAY;
        const gapMs = (gapMinutes || 30) * 60 * 1000;

        // Select the best available bucket granularity for this query
        const granularity = UsageService.selectGranularity(gapMinutes || 30, effectiveSince);

        // Load bucket records (the bucket cleanup ensures old data is gone)
        const buckets = await UsageService.loadBucketsByTime({ granularity }, effectiveSince, granularity);
        if (buckets.length === 0) {
            return { groups: [], totals: { totalTokens: 0, totalCost: 0, totalRequests: 0 } };
        }

        // Filter by requested account_ids if provided
        const accountSet = account_ids && account_ids.length > 0 ? new Set(account_ids) : null;
        const filteredBuckets = accountSet ? buckets.filter((b: any) => accountSet.has(b.account_id)) : buckets;

        // Group raw buckets by account_id
        const byAccount = new Map<string, any[]>();
        for (const bucket of filteredBuckets) {
            const aid = bucket.account_id;
            if (!byAccount.has(aid)) byAccount.set(aid, []);
            byAccount.get(aid)!.push(bucket);
        }

        let totalTokens = 0;
        let totalCost = 0;
        let totalRequests = 0;
        const groups: UserSessionGroup[] = [];

        for (const [accountId, accountBuckets] of byAccount) {
            accountBuckets.sort((a: any, b: any) => a.bucket_time - b.bucket_time);

            // Group into time windows matching gapMinutes
            const byWindow = new Map<number, any[]>();
            for (const bucket of accountBuckets) {
                const wStart = this.windowStart(bucket.bucket_time, gapMs);
                if (!byWindow.has(wStart)) byWindow.set(wStart, []);
                byWindow.get(wStart)!.push(bucket);
            }

            const sessions: UserSession[] = [];
            for (const [wStart, windowBuckets] of byWindow) {
                let input_tokens = 0, output_tokens = 0, cost = 0, requestCount = 0;
                const providerMap = new Map<string, ProviderUsage>();
                const modelMap = new Map<string, ModelUsage>();
                const modelAliases = new Set<string>();

                for (const bucket of windowBuckets) {
                    input_tokens += bucket.input_tokens || 0;
                    output_tokens += bucket.output_tokens || 0;
                    cost += bucket.cost || 0;
                    requestCount += bucket.request_count || 0;
                    modelAliases.add(bucket.model_alias);

                    const pkey = bucket.provider_id || "unknown";
                    if (!providerMap.has(pkey)) {
                        providerMap.set(pkey, { providerName: pkey, input_tokens: 0, output_tokens: 0 });
                    }
                    const p = providerMap.get(pkey)!;
                    p.input_tokens += bucket.input_tokens || 0;
                    p.output_tokens += bucket.output_tokens || 0;

                    const mkey = bucket.model_alias || "default";
                    if (!modelMap.has(mkey)) {
                        modelMap.set(mkey, { model_alias: mkey, input_tokens: 0, output_tokens: 0 });
                    }
                    const m = modelMap.get(mkey)!;
                    m.input_tokens += bucket.input_tokens || 0;
                    m.output_tokens += bucket.output_tokens || 0;
                }

                cost = Math.round(cost * 1_000_000) / 1_000_000;

                sessions.push({
                    startTime: wStart,
                    endTime: wStart + gapMs,
                    model_aliases: Array.from(modelAliases),
                    requestCount,
                    input_tokens,
                    output_tokens,
                    cost,
                    providerUsage: Array.from(providerMap.values()),
                    modelUsage: Array.from(modelMap.values()),
                    windowLabel: this.formatWindowLabel(wStart, gapMs),
                });

                totalTokens += input_tokens + output_tokens;
                totalCost += cost;
                totalRequests += requestCount;
            }

            // Latest sessions first
            sessions.sort((a, b) => b.startTime - a.startTime);

            const acct = await accountRepository.findIgnoreDelete({ id: accountId });
            const accountName = acct ? acct.name : "--";
            const groupTokens = sessions.reduce((sum, s) => sum + s.input_tokens + s.output_tokens, 0);
            const groupRequests = sessions.reduce((sum, s) => sum + s.requestCount, 0);
            groups.push({ account_id: accountId, accountName, sessions, totalTokens: groupTokens, totalRequests: groupRequests });
        }

        // Sort groups by latest session time
        groups.sort((a, b) => {
            const aMax = Math.max(...a.sessions.map(s => s.startTime));
            const bMax = Math.max(...b.sessions.map(s => s.startTime));
            return bMax - aMax;
        });

        // Keep only top 20 sessions across all groups
        const allSpans: { gi: number; si: number; st: number }[] = [];
        groups.forEach((g, gi) => g.sessions.forEach((s, si) => allSpans.push({ gi, si, st: s.startTime })));
        allSpans.sort((a, b) => b.st - a.st);
        const keep = new Set(allSpans.slice(0, 20).map(s => `${s.gi}:${s.si}`));
        groups.forEach((g, gi) => {
            g.sessions = g.sessions.filter((_, si) => keep.has(`${gi}:${si}`));
        });

        // Filter out sessions whose provider or model has been deleted
        const [activeProviders, activeModels] = await Promise.all([
            providerRepo.find({}),
            modelRepo.find({}),
        ]);
        const activeProviderIds = new Set(activeProviders.map(p => p.id));
        const activeModelAliases = new Set(activeModels.map(m => m.alias));

        const filtered = groups.filter(g => g.sessions.length > 0).map(g => ({
            ...g,
            sessions: g.sessions
                .map(s => ({
                    ...s,
                    providerUsage: account_ids && account_ids.length > 0 && !isAdmin
                        ? s.modelUsage.map(mu => ({ providerName: mu.model_alias, input_tokens: mu.input_tokens, output_tokens: mu.output_tokens }))
                        : s.providerUsage.filter(pu => activeProviderIds.has(pu.providerName)),
                }))
                .filter(s => s.providerUsage.length > 0 && s.model_aliases.some(m => activeModelAliases.has(m))),
        })).filter(g => g.sessions.length > 0);

        totalCost = Math.round(totalCost * 1_000_000) / 1_000_000;

        return { groups: filtered, totals: { totalTokens, totalCost, totalRequests } };
    }
}
