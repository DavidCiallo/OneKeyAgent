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

function getRawInputTokens(log: UsageLogEntity): number {
    return log.inputTokens || 0;
}

function getRawOutputTokens(log: UsageLogEntity): number {
    return log.outputTokens || 0;
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
        const todayLogs = allLogs.filter(l => l.create_time >= todayStart && l.create_time < nowTenMin + TEN_MIN);
        const last24hLogs = allLogs.filter(l => l.create_time >= last24hStart && l.create_time < nowTenMin + TEN_MIN);
        const weekLogs = allLogs.filter(l => l.create_time >= weekStart && l.create_time < nowTenMin + TEN_MIN);

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

    static async getUserSessions(gapMinutes?: number, since?: number, accountId?: string): Promise<UserSessionGroup[]> {
        const filter: Partial<UsageLogEntity> = {};
        if (accountId) filter.accountId = accountId;
        const allLogs = await usageRepo.find(filter, { since: since ?? Date.now() - MONTH });
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

                let cost = 0;
                for (const log of windowLogs) {
                    cost += (log.inputTokens * (log.inputPrice || 0) + log.outputTokens * (log.outputPrice || 0)) / 1_000_000;
                }
                cost = Math.round(cost * 1_000_000) / 1_000_000;

                sessions.push({
                    startTime: wStart,
                    endTime: wStart + gapMs,
                    modelAlias,
                    requestCount: windowLogs.length,
                    inputTokens,
                    outputTokens,
                    cost,
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

        return groups.filter(g => g.sessions.length > 0).map(g => ({
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
