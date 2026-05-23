import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";
import { UsageStatsPeriod, UsageStatsResult, UsageAmountData, UserSession, UserSessionGroup, ProviderUsage, ModelUsage } from "../../../shared/modules/usage/usage.interface";

const usageRepo = Repository.instance<UsageLogEntity>("usage_log");
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

function tenMinStart(ts: number): number {
    const localMidnight = localDayStart(ts);
    const offset = ts - localMidnight; // ms since local midnight
    const rounded = Math.floor(offset / TEN_MIN) * TEN_MIN;
    return localMidnight + rounded;
}

function getRawInputTokens(log: UsageLogEntity): number {
    return log.input_tokens || 0;
}

function getRawOutputTokens(log: UsageLogEntity): number {
    return log.output_tokens || 0;
}

function getRawTotalTokens(log: UsageLogEntity): number {
    return getRawInputTokens(log) + getRawOutputTokens(log);
}

function buildPeriod(logs: UsageLogEntity[], periodStart: number, periodEnd: number): UsageStatsPeriod {
    // Pre-generate all 10-min buckets in the period
    const bucketMap = new Map<number, number>();
    for (let t = periodStart; t < periodEnd; t += TEN_MIN) {
        bucketMap.set(t, 0);
    }

    for (const log of logs) {
        const h = tenMinStart(log.create_time);
        const tokens = getRawTotalTokens(log); // raw tokens, no tier multiplier
        bucketMap.set(h, (bucketMap.get(h) || 0) + tokens);
    }

    const amounts: UsageAmountData[] = [];
    let cumulative = 0;
    const sortedBuckets = [...bucketMap.entries()].sort(([a], [b]) => a - b);

    for (const [ts, bucketAmount] of sortedBuckets) {
        cumulative += bucketAmount;
        const amount = Math.round(cumulative / 1000000 * 100) / 100;
        // Only push points where amount actually changes (or the very first point)
        if (amounts.length === 0 || amounts[amounts.length - 1].amount !== amount) {
            amounts.push({ ts, amount });
        }
    }

    // Ensure the first bucket is always included (for timeline start)
    if (amounts.length === 0 && sortedBuckets.length > 0) {
        amounts.push({ ts: sortedBuckets[0][0], amount: 0 });
    }

    const total = amounts.length > 0 ? amounts[amounts.length - 1].amount : 0;
    return { total, amounts };
}

export class UsageService {
    static async find(page: number, filter: Partial<UsageLogEntity>, since?: number): Promise<{ list: UsageLogEntity[], total: number }> {
        const list = await usageRepo.find(filter, { offset: (page - 1) * 40, limit: 40, since });
        const total = since ? await usageRepo.count(filter, since) : await usageRepo.count(filter);
        return { list, total };
    }

    static async stats(model_alias?: string, account_id?: string): Promise<UsageStatsResult> {
        const now = Date.now();

        const todayStart = localDayStart(now); // local-timezone midnight
        const nowTenMin = tenMinStart(now);
        const last24hStart = nowTenMin - DAY;
        const weekStart = todayStart - 7 * DAY;

        const filter: Partial<UsageLogEntity> = {};
        if (model_alias) filter.model_alias = model_alias;

        const allLogs = await usageRepo.find(filter, { since: now - MONTH });
        const accountLogs = account_id ? allLogs.filter(l => l.account_id === account_id) : allLogs;
        const todayLogs = accountLogs.filter(l => l.create_time >= todayStart && l.create_time < nowTenMin + TEN_MIN);
        const last24hLogs = accountLogs.filter(l => l.create_time >= last24hStart && l.create_time < nowTenMin + TEN_MIN);
        const weekLogs = accountLogs.filter(l => l.create_time >= weekStart && l.create_time < nowTenMin + TEN_MIN);

        return {
            today: buildPeriod(todayLogs, todayStart, nowTenMin + TEN_MIN),
            last24h: buildPeriod(last24hLogs, last24hStart, nowTenMin + TEN_MIN),
            last7Days: buildPeriod(weekLogs, weekStart, nowTenMin + TEN_MIN),
        };
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
        // < 1h (15min, 30min): show as hh:mm-hh:mm
        return `${MM}/${DD} ${hh}:${mm}-${ehh}:${emm}`;
    }

    static async getUserSessions(gapMinutes?: number, since?: number, account_ids?: string[], isAdmin?: boolean): Promise<{ groups: UserSessionGroup[]; totals: { totalTokens: number; totalCost: number; totalRequests: number } }> {
        let allLogs: UsageLogEntity[];
        if (account_ids && account_ids.length > 0) {
            // Fetch logs per account and merge
            const results = await Promise.all(
                account_ids.map(id => usageRepo.find({ account_id: id } as Partial<UsageLogEntity>, { since: since ?? Date.now() - MONTH }))
            );
            allLogs = results.flat();
        } else {
            allLogs = await usageRepo.find({}, { since: since ?? Date.now() - MONTH });
        }
        const gapMs = (gapMinutes || 30) * 60 * 1000;

        // Compute totals from ALL raw logs before truncation
        let totalTokens = 0;
        let totalCost = 0;
        let totalRequests = allLogs.length;
        for (const log of allLogs) {
            totalTokens += getRawInputTokens(log) + getRawOutputTokens(log);
            totalCost += (log.input_tokens * (log.input_price || 0) + log.output_tokens * (log.output_price || 0)) / 1_000_000;
        }
        totalCost = Math.round(totalCost * 1_000_000) / 1_000_000;

        // Group by account_id
        const byAccount = new Map<string, UsageLogEntity[]>();
        for (const log of allLogs) {
            if (!byAccount.has(log.account_id)) byAccount.set(log.account_id, []);
            byAccount.get(log.account_id)!.push(log);
        }

        const groups: UserSessionGroup[] = [];

        for (const [account_id, logs] of byAccount) {
            // Sort by time ASC
            logs.sort((a, b) => a.create_time - b.create_time);

            // Group by windowStart only (not by model_alias)
            const byWindow = new Map<number, UsageLogEntity[]>();

            for (const log of logs) {
                const wStart = this.windowStart(log.create_time, gapMs);
                if (!byWindow.has(wStart)) byWindow.set(wStart, []);
                byWindow.get(wStart)!.push(log);
            }

            const sessions: UserSession[] = [];

            for (const [wStart, windowLogs] of byWindow) {
                const model_aliases = [...new Set(windowLogs.map(l => l.model_alias || "default"))];
                let input_tokens = 0;
                let output_tokens = 0;
                const providerMap = new Map<string, ProviderUsage>();
                const modelMap = new Map<string, ModelUsage>();

                for (const log of windowLogs) {
                    input_tokens += getRawInputTokens(log);
                    output_tokens += getRawOutputTokens(log);
                    const providerKey = log.provider_id || "unknown";
                    if (!providerMap.has(providerKey)) {
                        providerMap.set(providerKey, { providerName: providerKey, input_tokens: 0, output_tokens: 0 });
                    }
                    const p = providerMap.get(providerKey)!;
                    p.input_tokens += getRawInputTokens(log);
                    p.output_tokens += getRawOutputTokens(log);

                    const modelKey = log.model_alias || "default";
                    if (!modelMap.has(modelKey)) {
                        modelMap.set(modelKey, { model_alias: modelKey, input_tokens: 0, output_tokens: 0 });
                    }
                    const m = modelMap.get(modelKey)!;
                    m.input_tokens += getRawInputTokens(log);
                    m.output_tokens += getRawOutputTokens(log);
                }

                let cost = 0;
                for (const log of windowLogs) {
                    cost += (log.input_tokens * (log.input_price || 0) + log.output_tokens * (log.output_price || 0)) / 1_000_000;
                }
                cost = Math.round(cost * 1_000_000) / 1_000_000;

                sessions.push({
                    startTime: wStart,
                    endTime: wStart + gapMs,
                    model_aliases,
                    requestCount: windowLogs.length,
                    input_tokens,
                    output_tokens,
                    cost,
                    providerUsage: Array.from(providerMap.values()),
                    modelUsage: Array.from(modelMap.values()),
                    windowLabel: this.formatWindowLabel(wStart, gapMs),
                });
            }

            // Sort sessions by startTime descending
            sessions.sort((a, b) => b.startTime - a.startTime);

            const totalTokens = sessions.reduce((sum, s) => sum + s.input_tokens + s.output_tokens, 0);
            const totalRequests = sessions.reduce((sum, s) => sum + s.requestCount, 0);

            const acct = await accountRepository.findIgnoreDelete({ id: account_id });
            const accountName = acct ? acct.name : "--";
            groups.push({ account_id, accountName, sessions, totalTokens, totalRequests });
        }

        // Sort by latest session startTime DESC
        groups.sort((a, b) => {
            const aMax = Math.max(...a.sessions.map(s => s.startTime));
            const bMax = Math.max(...b.sessions.map(s => s.startTime));
            return bMax - aMax;
        });

        // Flatten all sessions with group info, sort by time DESC, take latest 20
        const allSessions: { groupIndex: number; sessionIndex: number; startTime: number }[] = [];
        for (let gi = 0; gi < groups.length; gi++) {
            for (let si = 0; si < groups[gi].sessions.length; si++) {
                allSessions.push({ groupIndex: gi, sessionIndex: si, startTime: groups[gi].sessions[si].startTime });
            }
        }
        allSessions.sort((a, b) => b.startTime - a.startTime);
        const keepSessions = new Set(allSessions.slice(0, 20).map(s => `${s.groupIndex}:${s.sessionIndex}`));

        // Filter out sessions not in the top 20, and remove empty groups
        for (let gi = 0; gi < groups.length; gi++) {
            groups[gi].sessions = groups[gi].sessions.filter((_, si) => keepSessions.has(`${gi}:${si}`));
        }

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

        return { groups: filtered, totals: { totalTokens, totalCost, totalRequests } };
    }
}
