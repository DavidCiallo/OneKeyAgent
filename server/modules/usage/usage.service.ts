import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { UsageBucketEntity } from "../../../shared/modules/usage/usage_bucket.entity";
import { UsageStatsPeriod, UsageStatsResult, UsageAmountData, UserSession, UserSessionGroup, ProviderUsage, ModelUsage } from "../../../shared/modules/usage/usage.interface";

import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";

const bucketRepo = Repository.instance<UsageBucketEntity>("usage_bucket");
const modelRepo = Repository.instance<ModelEntity>("Model");
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

/** Convert a pre-filled map (time slot → tokens) into a UsageStatsPeriod with cumulative sums */
function mapToPeriod(bucketMap: Map<number, number>): UsageStatsPeriod {
    const amounts: UsageAmountData[] = [];
    let cumulative = 0;
    const sorted = [...bucketMap.entries()].sort(([a], [b]) => a - b);

    for (const [ts, bucketAmount] of sorted) {
        cumulative += bucketAmount;
        const amount = Math.round(cumulative / 1_000_000 * 100) / 100;
        if (amounts.length === 0 || amounts[amounts.length - 1].amount !== amount) {
            amounts.push({ ts, amount });
        }
    }

    if (amounts.length === 0 && sorted.length > 0) {
        amounts.push({ ts: sorted[0][0], amount: 0 });
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

        // Pre-fill maps with 0 for each 10-min slot
        const todayMap = new Map<number, number>();
        const last24hMap = new Map<number, number>();
        for (let t = todayStart; t < now; t += TEN_MIN) todayMap.set(t, 0);
        for (let t = last24hStart; t < now; t += TEN_MIN) last24hMap.set(t, 0);

        // Pass 1: stream 1m records (covers today and last24h)
        const filter1m: any = { granularity: "1m", bucket_time: { $gte: last24hStart } };
        if (model_alias) filter1m.model_alias = model_alias;
        if (account_id) filter1m.account_id = account_id;

        await bucketRepo.findEach(filter1m, (bucket: any) => {
            const bt = bucket.bucket_time;
            const tokens = (bucket.input_tokens || 0) + (bucket.output_tokens || 0);
            if (bt >= todayStart && todayMap.has(bt)) {
                todayMap.set(bt, (todayMap.get(bt) || 0) + tokens);
            }
            if (bt >= last24hStart && last24hMap.has(bt)) {
                last24hMap.set(bt, (last24hMap.get(bt) || 0) + tokens);
            }
        });

        // Pre-fill week map
        const weekMap = new Map<number, number>();
        for (let t = weekStart; t < now; t += TEN_MIN) weekMap.set(t, 0);

        // Pass 2: stream 1d records for weekly overview
        const filter1d: any = { granularity: "1d", bucket_time: { $gte: weekStart } };
        if (model_alias) filter1d.model_alias = model_alias;
        if (account_id) filter1d.account_id = account_id;

        await bucketRepo.findEach(filter1d, (bucket: any) => {
            const bt = bucket.bucket_time;
            const tokens = (bucket.input_tokens || 0) + (bucket.output_tokens || 0);
            const slots = bucketSlots("1d");
            const tokensPerSlot = tokens / slots;
            for (let i = 0; i < slots; i++) {
                const slot = bt + i * TEN_MIN;
                if (weekMap.has(slot)) {
                    weekMap.set(slot, (weekMap.get(slot) || 0) + tokensPerSlot);
                }
            }
        });

        return {
            today: mapToPeriod(todayMap),
            last24h: mapToPeriod(last24hMap),
            last7Days: mapToPeriod(weekMap),
        };
    }

    /**
     * Batch stats: query all model_aliases at once by reading 1m and 1d data once.
     * Returns a map of model_alias → UsageStatsResult.
     */
    static async statsBatch(model_aliases: string[], account_id?: string): Promise<Map<string, UsageStatsResult>> {
        const now = Date.now();
        const todayStart = localDayStart(now);
        const last24hStart = now - DAY;
        const weekStart = now - 7 * DAY;

        const baseFilter: any = {};
        if (account_id) baseFilter.account_id = account_id;

        // Pre-fill maps for each alias
        const aliasesSet = new Set(model_aliases);
        const todayMaps = new Map<string, Map<number, number>>();
        const last24hMaps = new Map<string, Map<number, number>>();
        const weekMaps = new Map<string, Map<number, number>>();

        for (const alias of aliasesSet) {
            const tm = new Map<number, number>();
            const l24m = new Map<number, number>();
            const wm = new Map<number, number>();
            for (let t = todayStart; t < now; t += TEN_MIN) tm.set(t, 0);
            for (let t = last24hStart; t < now; t += TEN_MIN) l24m.set(t, 0);
            for (let t = weekStart; t < now; t += TEN_MIN) wm.set(t, 0);
            todayMaps.set(alias, tm);
            last24hMaps.set(alias, l24m);
            weekMaps.set(alias, wm);
        }

        // Pass 1: stream 1m records
        await bucketRepo.findEach(
            { ...baseFilter, granularity: "1m", bucket_time: { $gte: last24hStart } },
            (bucket: any) => {
                const alias = bucket.model_alias || "__unknown__";
                const todayMap = todayMaps.get(alias);
                const last24hMap = last24hMaps.get(alias);
                if (!todayMap && !last24hMap) return;

                const bt = bucket.bucket_time;
                const tokens = (bucket.input_tokens || 0) + (bucket.output_tokens || 0);
                if (bt >= todayStart && todayMap?.has(bt)) {
                    todayMap.set(bt, (todayMap.get(bt) || 0) + tokens);
                }
                if (bt >= last24hStart && last24hMap?.has(bt)) {
                    last24hMap.set(bt, (last24hMap.get(bt) || 0) + tokens);
                }
            },
        );

        // Pass 2: stream 1d records
        await bucketRepo.findEach(
            { ...baseFilter, granularity: "1d", bucket_time: { $gte: weekStart } },
            (bucket: any) => {
                const alias = bucket.model_alias || "__unknown__";
                const weekMap = weekMaps.get(alias);
                if (!weekMap) return;

                const bt = bucket.bucket_time;
                const tokens = (bucket.input_tokens || 0) + (bucket.output_tokens || 0);
                const slots = bucketSlots("1d");
                const tokensPerSlot = tokens / slots;
                for (let i = 0; i < slots; i++) {
                    const slot = bt + i * TEN_MIN;
                    if (weekMap.has(slot)) {
                        weekMap.set(slot, (weekMap.get(slot) || 0) + tokensPerSlot);
                    }
                }
            },
        );

        const results = new Map<string, UsageStatsResult>();
        for (const alias of model_aliases) {
            results.set(alias, {
                today: mapToPeriod(todayMaps.get(alias) || new Map()),
                last24h: mapToPeriod(last24hMaps.get(alias) || new Map()),
                last7Days: mapToPeriod(weekMaps.get(alias) || new Map()),
            });
        }
        return results;
    }

    /** Pick the coarsest granularity that still provides adequate precision for the query */
    private static selectGranularity(gapMinutes: number, since: number): string {
        // If the caller wants minute-level precision, always use 1m regardless of range
        if (gapMinutes <= 5) return "1m";
        const rangeDays = (Date.now() - since) / DAY;
        if (rangeDays <= 1) return "1m";
        if (rangeDays <= 90) return "60m";
        return "1d";
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

    static async getUserSessions(gapMinutes?: number, since?: number, account_ids?: string[], isAdmin?: boolean):
    Promise<{ groups: UserSessionGroup[]; totals: { totalTokens: number; totalCost: number; totalRequests: number }; recentSessions: (UserSession & { account_id: string })[] }> {
        const now = Date.now();
        const effectiveSince = since ?? now - 7 * DAY;
        const gapMs = (gapMinutes || 30) * 60 * 1000;
        const granularity = UsageService.selectGranularity(gapMinutes || 30, effectiveSince);
        const accountSet = account_ids && account_ids.length > 0 ? new Set(account_ids) : null;
        const ONE_MIN_MS = 60_000;
        // 1m recent sessions: at most 1 day back, capped to 20 rows
        const since1m = Math.max(effectiveSince, now - DAY);

        // Window accumulator types — built inline during streaming
        type WinAcc = {
            input_tokens: number; cached_input_tokens: number; output_tokens: number; cost: number; requestCount: number;
            providerMap: Map<string, ProviderUsage>; modelMap: Map<string, ModelUsage>;
            modelAliases: Set<string>;
        };
        type WinAcc1m = {
            input_tokens: number; cached_input_tokens: number; output_tokens: number; cost: number; requestCount: number;
            modelAliases: Set<string>;
        };

        const byAccountWindow = new Map<string, Map<number, WinAcc>>();
        const byAccountWindow1m = new Map<string, Map<number, WinAcc1m>>();

        // Single streaming pass — aggregate into window accumulators per account
        const rowCount = await bucketRepo.findEach(
            { granularity, bucket_time: { $gte: effectiveSince } },
            (bucket: any) => {
                const aid = bucket.account_id;
                if (accountSet && !accountSet.has(aid)) return;

                const wStart = this.windowStart(bucket.bucket_time, gapMs);
                const wStart1m = this.windowStart(bucket.bucket_time, ONE_MIN_MS);

                // --- gapMs window accumulator ---
                let acWin = byAccountWindow.get(aid);
                if (!acWin) { acWin = new Map(); byAccountWindow.set(aid, acWin); }
                let acc = acWin.get(wStart);
                if (!acc) {
                    acc = {
                        input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, cost: 0, requestCount: 0,
                        providerMap: new Map(), modelMap: new Map(), modelAliases: new Set(),
                    };
                    acWin.set(wStart, acc);
                }

                acc.input_tokens += bucket.input_tokens || 0;
                acc.cached_input_tokens += bucket.cached_input_tokens || 0;
                acc.output_tokens += bucket.output_tokens || 0;
                acc.cost += bucket.cost || 0;
                acc.requestCount += bucket.request_count || 0;
                acc.modelAliases.add(bucket.model_alias);

                const pkey = bucket.provider_id || "unknown";
                if (!acc.providerMap.has(pkey)) {
                    acc.providerMap.set(pkey, { providerName: pkey, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 });
                }
                const p = acc.providerMap.get(pkey)!;
                p.input_tokens += bucket.input_tokens || 0;
                p.cached_input_tokens += bucket.cached_input_tokens || 0;
                p.output_tokens += bucket.output_tokens || 0;

                const mkey = bucket.model_alias || "default";
                if (!acc.modelMap.has(mkey)) {
                    acc.modelMap.set(mkey, { model_alias: mkey, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 });
                }
                const m = acc.modelMap.get(mkey)!;
                m.input_tokens += bucket.input_tokens || 0;
                m.cached_input_tokens += bucket.cached_input_tokens || 0;
                m.output_tokens += bucket.output_tokens || 0;

                // --- 1m window accumulator (only for last 20 minutes) ---
                if (bucket.bucket_time >= since1m) {
                    let acWin1m = byAccountWindow1m.get(aid);
                    if (!acWin1m) { acWin1m = new Map(); byAccountWindow1m.set(aid, acWin1m); }
                    let acc1m = acWin1m.get(wStart1m);
                    if (!acc1m) {
                        acc1m = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, cost: 0, requestCount: 0, modelAliases: new Set() };
                        acWin1m.set(wStart1m, acc1m);
                    }

                    acc1m.input_tokens += bucket.input_tokens || 0;
                    acc1m.cached_input_tokens += bucket.cached_input_tokens || 0;
                    acc1m.output_tokens += bucket.output_tokens || 0;
                    acc1m.cost += bucket.cost || 0;
                    acc1m.requestCount += bucket.request_count || 0;
                    acc1m.modelAliases.add(bucket.model_alias);
                }
            },
        );

        if (rowCount === 0) {
            return { groups: [], totals: { totalTokens: 0, totalCost: 0, totalRequests: 0 }, recentSessions: [] };
        }

        // Build sessions from window accumulators
        let totalTokens = 0, totalCost = 0, totalRequests = 0;
        const groups: UserSessionGroup[] = [];
        const recentSessionsFlat: (UserSession & { account_id: string })[] = [];

        for (const [aid, acWin] of byAccountWindow) {
            const sessions: UserSession[] = [];
            for (const [wStart, acc] of acWin) {
                acc.cost = Math.round(acc.cost * 1_000_000) / 1_000_000;
                sessions.push({
                    startTime: wStart, endTime: wStart + gapMs,
                    model_aliases: Array.from(acc.modelAliases),
                    requestCount: acc.requestCount,
                    input_tokens: acc.input_tokens, cached_input_tokens: acc.cached_input_tokens,
                    output_tokens: acc.output_tokens,
                    cost: acc.cost,
                    providerUsage: Array.from(acc.providerMap.values()),
                    modelUsage: Array.from(acc.modelMap.values()),
                    windowLabel: this.formatWindowLabel(wStart, gapMs),
                });
                totalTokens += acc.input_tokens + acc.output_tokens;
                totalCost += acc.cost;
                totalRequests += acc.requestCount;
            }

            sessions.sort((a, b) => b.startTime - a.startTime);

            // Build 1m sessions
            const acWin1m = byAccountWindow1m.get(aid);
            if (acWin1m) {
                for (const [wStart1m, acc1m] of acWin1m) {
                    acc1m.cost = Math.round(acc1m.cost * 1_000_000) / 1_000_000;
                    recentSessionsFlat.push({
                        account_id: aid, startTime: wStart1m, endTime: wStart1m + ONE_MIN_MS,
                        model_aliases: Array.from(acc1m.modelAliases),
                        requestCount: acc1m.requestCount,
                        input_tokens: acc1m.input_tokens, cached_input_tokens: acc1m.cached_input_tokens,
                        output_tokens: acc1m.output_tokens,
                        cost: acc1m.cost,
                        providerUsage: [], modelUsage: [],
                        windowLabel: this.formatWindowLabel(wStart1m, ONE_MIN_MS),
                    });
                }
            }

            const acct = await accountRepository.findIgnoreDelete({ id: aid });
            const accountName = acct ? acct.name : "--";
            const groupTokens = sessions.reduce((sum, s) => sum + s.input_tokens + s.output_tokens, 0);
            const groupRequests = sessions.reduce((sum, s) => sum + s.requestCount, 0);
            groups.push({ account_id: aid, accountName, sessions, totalTokens: groupTokens, totalRequests: groupRequests });
        }

        // Sort groups by latest session time
        groups.sort((a, b) => {
            const aMax = Math.max(...a.sessions.map(s => s.startTime));
            const bMax = Math.max(...b.sessions.map(s => s.startTime));
            return bMax - aMax;
        });

        // Keep only top 200 sessions across all groups (allows full chart rendering for longer ranges)
        const allSpans: { gi: number; si: number; st: number }[] = [];
        groups.forEach((g, gi) => g.sessions.forEach((s, si) => allSpans.push({ gi, si, st: s.startTime })));
        allSpans.sort((a, b) => b.st - a.st);
        const keep = new Set(allSpans.slice(0, 200).map(s => `${s.gi}:${s.si}`));
        groups.forEach((g, gi) => { g.sessions = g.sessions.filter((_, si) => keep.has(`${gi}:${si}`)); });

        // Filter out sessions whose model has been deleted, and resolve provider names
        const activeModels = await modelRepo.find({});
        const activeModelAliases = new Set(activeModels.map(m => m.alias));

        const activeProviders = await Repository.instance<ProviderEntity>("Provider").find({});
        const providerNameMap = new Map(activeProviders.map(p => [p.id, p.name]));
        const activeProviderIds = new Set(activeProviders.filter(p => !p.delete_time).map(p => p.id));

        const filtered = groups
            .map(g => ({
                ...g,
                sessions: g.sessions
                    .map(s => ({
                        ...s,
                        providerUsage: account_ids && account_ids.length > 0 && !isAdmin
                            ? s.modelUsage.map(mu => ({ providerName: mu.model_alias, input_tokens: mu.input_tokens, cached_input_tokens: mu.cached_input_tokens, output_tokens: mu.output_tokens }))
                            : s.providerUsage
                                .filter(pu => activeProviderIds.has(pu.providerName))
                                .map(pu => ({ ...pu, providerName: providerNameMap.get(pu.providerName) || pu.providerName })),
                    }))
                    .filter(s => s.model_aliases.some(m => activeModelAliases.has(m))),
            }))
            .filter(g => g.sessions.length > 0);

        totalCost = Math.round(totalCost * 1_000_000) / 1_000_000;

        recentSessionsFlat.sort((a, b) => b.startTime - a.startTime);
        const topRecent = recentSessionsFlat.slice(0, 20);

        return { groups: filtered, totals: { totalTokens, totalCost, totalRequests }, recentSessions: topRecent };
    }
}
