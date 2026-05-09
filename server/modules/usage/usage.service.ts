import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";
import { UsageStatsPeriod, UsageStatsResult, UsageAmountData, UserSession, UserSessionGroup, ProviderUsage } from "../../../shared/modules/usage/usage.interface";

const usageRepo = Repository.instance<UsageLogEntity>("UsageLog");
const modelRepo = Repository.instance<ModelEntity>("Model");
const providerRepo = Repository.instance<ProviderEntity>("Provider");

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

async function getTierMap(logs: UsageLogEntity[]): Promise<Map<string, number>> {
    const aliases = [...new Set(logs.map(log => log.modelAlias).filter(Boolean))];
    if (aliases.length === 0) return new Map();

    const models = await modelRepo.find({ delete_time: null });
    const tierMap = new Map<string, number>();
    for (const model of models) {
        if (!aliases.includes(model.alias)) continue;
        const currentTier = tierMap.get(model.alias) ?? 0;
        tierMap.set(model.alias, Math.max(currentTier, model.tier ?? 1));
    }
    return tierMap;
}

function getRawInputTokens(log: UsageLogEntity): number {
    return log.inputTokens || 0;
}

function getRawOutputTokens(log: UsageLogEntity): number {
    return log.outputTokens || 0;
}

function getRawTotalTokens(log: UsageLogEntity): number {
    return getRawInputTokens(log) + getRawOutputTokens(log);
}

function getBilledInputTokens(log: UsageLogEntity, tierMap: Map<string, number>): number {
    if (log.tierSnapshot == null) return log.inputTokens || 0;
    return (log.inputTokens || 0) * (log.tierSnapshot || tierMap.get(log.modelAlias) || 1);
}

function getBilledOutputTokens(log: UsageLogEntity, tierMap: Map<string, number>): number {
    if (log.tierSnapshot == null) return log.outputTokens || 0;
    return (log.outputTokens || 0) * (log.tierSnapshot || tierMap.get(log.modelAlias) || 1);
}

function getBilledTotalTokens(log: UsageLogEntity, tierMap: Map<string, number>): number {
    return getBilledInputTokens(log, tierMap) + getBilledOutputTokens(log, tierMap);
}

function buildPeriod(logs: UsageLogEntity[], periodStart: number, periodEnd: number, tierMap: Map<string, number>): UsageStatsPeriod {
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

    for (const [ts] of bucketMap) {
        cumulative += bucketMap.get(ts)!;
        amounts.push({ ts, amount: Math.round(cumulative / 1000000 * 100) / 100 });
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

    static async stats(modelAlias?: string): Promise<UsageStatsResult> {
        const now = Date.now();

        const todayStart = localDayStart(now); // local-timezone midnight
        const nowTenMin = tenMinStart(now);
        const last24hStart = nowTenMin - DAY;
        const weekStart = todayStart - 7 * DAY;

        const filter: Partial<UsageLogEntity> = {};
        if (modelAlias) filter.modelAlias = modelAlias;

        const allLogs = await usageRepo.find(filter, { since: now - MONTH });
        const tierMap = await getTierMap(allLogs);
        const todayLogs = allLogs.filter(l => l.create_time >= todayStart && l.create_time < nowTenMin + TEN_MIN);
        const last24hLogs = allLogs.filter(l => l.create_time >= last24hStart && l.create_time < nowTenMin + TEN_MIN);
        const weekLogs = allLogs.filter(l => l.create_time >= weekStart && l.create_time < nowTenMin + TEN_MIN);

        return {
            today: buildPeriod(todayLogs, todayStart, nowTenMin + TEN_MIN, tierMap),
            last24h: buildPeriod(last24hLogs, last24hStart, nowTenMin + TEN_MIN, tierMap),
            last7Days: buildPeriod(weekLogs, weekStart, nowTenMin + TEN_MIN, tierMap),
        };
    }

    static async myStats(accountId: string): Promise<{ today: number; thisWeek: number; total: number }> {
        const now = Date.now();

        const todayStart = localDayStart(now);
        const weekStart = todayStart - 7 * DAY;
        const nowTenMin = tenMinStart(now);

        const allLogs = await usageRepo.find({ accountId }, { since: now - MONTH });
        const todayLogs = allLogs.filter(l => l.create_time >= todayStart && l.create_time < nowTenMin + TEN_MIN);
        const weekLogs = allLogs.filter(l => l.create_time >= weekStart && l.create_time < nowTenMin + TEN_MIN);

        const sum = (logs: UsageLogEntity[]) =>
            logs.reduce((acc, l) => acc + getRawTotalTokens(l), 0);

        return {
            today: sum(todayLogs),
            thisWeek: sum(weekLogs),
            total: sum(allLogs),
        };
    }

    /** Get total billed tokens for an account in the current month */
    static async monthlyBilledTokens(accountId: string): Promise<number> {
        const d = new Date();
        const monthStartTs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();

        const allLogs = await usageRepo.find({ accountId });
        const tierMap = await getTierMap(allLogs);
        const thisMonthLogs = allLogs.filter(l => l.create_time >= monthStartTs);
        return thisMonthLogs.reduce((acc, l) => acc + getBilledTotalTokens(l, tierMap), 0);
    }

    /** Get total billed tokens for an account in the current week */
    static async weeklyBilledTokens(accountId: string): Promise<number> {
        const weekStart = localDayStart(Date.now()) - 7 * 86400000;

        const allLogs = await usageRepo.find({ accountId });
        const tierMap = await getTierMap(allLogs);
        const thisWeekLogs = allLogs.filter(l => l.create_time >= weekStart);
        return thisWeekLogs.reduce((acc, l) => acc + getBilledTotalTokens(l, tierMap), 0);
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

    static async getUserSessions(gapMinutes?: number, since?: number): Promise<UserSessionGroup[]> {
        const allLogs = await usageRepo.find({}, { since: since ?? Date.now() - MONTH });
        const tierMap = await getTierMap(allLogs);
        const gapMs = (gapMinutes || 30) * 60 * 1000;

        // Group by accountId
        const byAccount = new Map<string, UsageLogEntity[]>();
        for (const log of allLogs) {
            if (!byAccount.has(log.accountId)) byAccount.set(log.accountId, []);
            byAccount.get(log.accountId)!.push(log);
        }

        const groups: UserSessionGroup[] = [];

        for (const [accountId, logs] of byAccount) {
            // Sort by time ASC
            logs.sort((a, b) => a.create_time - b.create_time);

            // Group by (modelAlias, windowStart)
            type WindowKey = string; // `${modelAlias}|${windowStart}`
            const byWindow = new Map<WindowKey, UsageLogEntity[]>();

            for (const log of logs) {
                const wStart = this.windowStart(log.create_time, gapMs);
                const key = `${log.modelAlias || "default"}|${wStart}`;
                if (!byWindow.has(key)) byWindow.set(key, []);
                byWindow.get(key)!.push(log);
            }

            const sessions: UserSession[] = [];

            for (const [key, windowLogs] of byWindow) {
                const modelAlias = windowLogs[0].modelAlias;
                const wStart = Number(key.split("|")[1]);
                let inputTokens = 0;
                let outputTokens = 0;
                const providerMap = new Map<string, ProviderUsage>();

                for (const log of windowLogs) {
                    inputTokens += getRawInputTokens(log);
                    outputTokens += getRawOutputTokens(log);
                    const key = log.providerId || "unknown";
                    if (!providerMap.has(key)) {
                        providerMap.set(key, { providerName: key, inputTokens: 0, outputTokens: 0 });
                    }
                    const p = providerMap.get(key)!;
                    p.inputTokens += getRawInputTokens(log);
                    p.outputTokens += getRawOutputTokens(log);
                }

                sessions.push({
                    startTime: wStart,
                    endTime: wStart + gapMs,
                    modelAlias,
                    requestCount: windowLogs.length,
                    inputTokens,
                    outputTokens,
                    tierSnapshot: windowLogs[0]?.tierSnapshot ?? tierMap.get(modelAlias) ?? 1,
                    providerUsage: Array.from(providerMap.values()),
                    windowLabel: this.formatWindowLabel(wStart, gapMs),
                });
            }

            // Sort sessions by startTime descending
            sessions.sort((a, b) => b.startTime - a.startTime);

            const totalTokens = sessions.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0);
            const totalRequests = sessions.reduce((sum, s) => sum + s.requestCount, 0);

            groups.push({ accountId, accountName: accountId, sessions, totalTokens, totalRequests });
        }

        // Sort by latest session startTime DESC
        groups.sort((a, b) => {
            const aMax = Math.max(...a.sessions.map(s => s.startTime));
            const bMax = Math.max(...b.sessions.map(s => s.startTime));
            return bMax - aMax;
        });

        // Filter out sessions whose provider or model has been deleted
        const [activeProviders, activeModels] = await Promise.all([
            providerRepo.find({}),
            modelRepo.find({}),
        ]);
        const activeProviderIds = new Set(activeProviders.map(p => p.id));
        const activeModelAliases = new Set(activeModels.map(m => m.alias));

        return groups.map(g => ({
            ...g,
            sessions: g.sessions
                .map(s => ({
                    ...s,
                    providerUsage: s.providerUsage.filter(pu => activeProviderIds.has(pu.providerName)),
                }))
                .filter(s => s.providerUsage.length > 0 && activeModelAliases.has(s.modelAlias)),
        })).filter(g => g.sessions.length > 0);
    }
}
