import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";
import { UsageStatsPeriod, UsageStatsResult, UsageAmountData, UserSession, UserSessionGroup, ProviderUsage } from "../../../shared/modules/usage/usage.interface";

const usageRepo = Repository.instance<UsageLogEntity>("UsageLog");
const modelRepo = Repository.instance<ModelEntity>("Model");

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
        const tokens = getBilledTotalTokens(log, tierMap);
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

/** Build a UserSession from a list of consecutive usage logs (same modelAlias, gap < 15 min) */
function buildSession(logs: UsageLogEntity[], tierMap: Map<string, number>): UserSession {
    let inputTokens = 0;
    let outputTokens = 0;
    const providerMap = new Map<string, ProviderUsage>();

    for (const log of logs) {
        inputTokens += getBilledInputTokens(log, tierMap);
        outputTokens += getBilledOutputTokens(log, tierMap);
        const key = log.providerId || "unknown";
        if (!providerMap.has(key)) {
            providerMap.set(key, { providerName: key, inputTokens: 0, outputTokens: 0 });
        }
        const p = providerMap.get(key)!;
        p.inputTokens += getBilledInputTokens(log, tierMap);
        p.outputTokens += getBilledOutputTokens(log, tierMap);
    }

    return {
        startTime: logs[0].create_time,
        endTime: logs[logs.length - 1].create_time,
        modelAlias: logs[0].modelAlias,
        inputTokens,
        outputTokens,
        providerUsage: Array.from(providerMap.values()),
    };
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
        const tierMap = await getTierMap(allLogs);
        const todayLogs = allLogs.filter(l => l.create_time >= todayStart && l.create_time < nowTenMin + TEN_MIN);
        const weekLogs = allLogs.filter(l => l.create_time >= weekStart && l.create_time < nowTenMin + TEN_MIN);

        const sum = (logs: UsageLogEntity[]) =>
            logs.reduce((acc, l) => acc + getBilledTotalTokens(l, tierMap), 0);

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

    /** Get usage grouped by user with continuous sessions (same modelAlias, gap < 15 min) */
    static async getUserSessions(): Promise<UserSessionGroup[]> {
        const allLogs = await usageRepo.find({}, { since: Date.now() - MONTH });
        const tierMap = await getTierMap(allLogs);
        const SESSION_GAP = 30 * 60 * 1000; // 30 minutes

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

            const sessions: UserSession[] = [];
            let currentSession: UsageLogEntity[] = [logs[0]];

            for (let i = 1; i < logs.length; i++) {
                const prev = logs[i - 1];
                const curr = logs[i];
                const gap = curr.create_time - prev.create_time;

                if (gap < SESSION_GAP && curr.modelAlias === prev.modelAlias) {
                    currentSession.push(curr);
                } else {
                    sessions.push(buildSession(currentSession, tierMap));
                    currentSession = [curr];
                }
            }
            if (currentSession.length > 0) {
                sessions.push(buildSession(currentSession, tierMap));
            }

            const totalTokens = sessions.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0);

            groups.push({ accountId, accountName: accountId, sessions, totalTokens });
        }

        // Sort by totalTokens DESC
        groups.sort((a, b) => b.totalTokens - a.totalTokens);

        return groups;
    }
}
