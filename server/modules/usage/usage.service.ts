import Repository from "../../lib/repository";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";
import { UsageStatsPeriod, UsageStatsResult, UsageAmountData } from "../../../shared/modules/usage/usage.interface";

const usageRepo = Repository.instance<UsageLogEntity>("UsageLog");

const TEN_MIN = 10 * 60 * 1000;

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

function buildPeriod(logs: UsageLogEntity[], periodStart: number, periodEnd: number): UsageStatsPeriod {
    // Pre-generate all 10-min buckets in the period
    const bucketMap = new Map<number, number>();
    for (let t = periodStart; t < periodEnd; t += TEN_MIN) {
        bucketMap.set(t, 0);
    }

    for (const log of logs) {
        const h = tenMinStart(log.create_time);
        const tokens = (log.inputTokens || 0) + (log.outputTokens || 0);
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
    static async find(page: number, filter: Partial<UsageLogEntity>): Promise<{ list: UsageLogEntity[], total: number }> {
        const list = await usageRepo.find(filter, { offset: (page - 1) * 40, limit: 40 });
        const total = await usageRepo.count(filter);
        return { list, total };
    }

    static async stats(modelAlias?: string): Promise<UsageStatsResult> {
        const now = Date.now();
        const DAY = 86400000;

        const todayStart = localDayStart(now); // local-timezone midnight
        const nowTenMin = tenMinStart(now);
        const last24hStart = nowTenMin - DAY;
        const weekStart = todayStart - 7 * DAY;

        const filter: Partial<UsageLogEntity> = {};
        if (modelAlias) filter.modelAlias = modelAlias;

        const allLogs = await usageRepo.find(filter);
        const todayLogs = allLogs.filter(l => l.create_time >= todayStart && l.create_time < nowTenMin + TEN_MIN);
        const last24hLogs = allLogs.filter(l => l.create_time >= last24hStart && l.create_time < nowTenMin + TEN_MIN);
        const weekLogs = allLogs.filter(l => l.create_time >= weekStart && l.create_time < nowTenMin + TEN_MIN);

        return {
            today: buildPeriod(todayLogs, todayStart, nowTenMin + TEN_MIN),
            last24h: buildPeriod(last24hLogs, last24hStart, nowTenMin + TEN_MIN),
            last7Days: buildPeriod(weekLogs, weekStart, nowTenMin + TEN_MIN),
        };
    }

    static async myStats(accountId: string): Promise<{ today: number; thisWeek: number; total: number }> {
        const now = Date.now();
        const DAY = 86400000;

        const todayStart = localDayStart(now);
        const weekStart = todayStart - 7 * DAY;
        const nowTenMin = tenMinStart(now);

        const allLogs = await usageRepo.find({ accountId });
        const todayLogs = allLogs.filter(l => l.create_time >= todayStart && l.create_time < nowTenMin + TEN_MIN);
        const weekLogs = allLogs.filter(l => l.create_time >= weekStart && l.create_time < nowTenMin + TEN_MIN);

        const sum = (logs: UsageLogEntity[]) =>
            Math.round(logs.reduce((acc, l) => acc + (l.inputTokens || 0) + (l.outputTokens || 0), 0) / 1000);

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
        const thisMonthLogs = allLogs.filter(l => l.create_time >= monthStartTs);
        return thisMonthLogs.reduce((acc, l) => acc + (l.inputTokens || 0) + (l.outputTokens || 0), 0);
    }
}
