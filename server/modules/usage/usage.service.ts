import Repository from "../../lib/repository";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";
import { UsageStatsPeriod, UsageStatsResult, UsageAmountData } from "../../../shared/modules/usage/usage.interface";

const usageRepo = Repository.instance<UsageLogEntity>("UsageLog");

const TEN_MIN = 10 * 60 * 1000;

function tenMinStart(ts: number): number {
    // Use local midnight offset so boundaries align with local day, not UTC day
    const localDayStart = dayStart(ts);
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    const localDayStartLocal = d.getTime();
    const tzOffset = localDayStartLocal - localDayStart;
    const localTs = ts + tzOffset;
    const rounded = Math.floor(localTs / TEN_MIN) * TEN_MIN;
    return rounded - tzOffset;
}

function dayStart(ts: number): number {
    return Math.floor(ts / 86400000) * 86400000;
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

    static async stats(modelId?: string): Promise<UsageStatsResult> {
        const now = Date.now();
        const DAY = 86400000;

        const todayStart = dayStart(now);
        const nowTenMin = tenMinStart(now);
        const last24hStart = nowTenMin - DAY;
        const weekStart = todayStart - 7 * DAY;

        const filter: Partial<UsageLogEntity> = {};
        if (modelId) filter.modelId = modelId;

        const allLogs = await usageRepo.find(filter);
        const todayLogs = allLogs.filter(l => l.create_time >= todayStart && l.create_time <= nowTenMin);
        const last24hLogs = allLogs.filter(l => l.create_time >= last24hStart && l.create_time <= nowTenMin);
        const weekLogs = allLogs.filter(l => l.create_time >= weekStart && l.create_time <= nowTenMin);

        return {
            today: buildPeriod(todayLogs, todayStart, nowTenMin),
            last24h: buildPeriod(last24hLogs, last24hStart, nowTenMin),
            last7Days: buildPeriod(weekLogs, weekStart, nowTenMin),
        };
    }

    static async myStats(apiKey: string): Promise<{ today: number; thisWeek: number; total: number }> {
        const now = Date.now();
        const DAY = 86400000;

        const todayStart = dayStart(now);
        const weekStart = todayStart - 7 * DAY;
        const nowTenMin = tenMinStart(now);

        const allLogs = await usageRepo.find({ apiKey });
        const todayLogs = allLogs.filter(l => l.create_time >= todayStart && l.create_time <= nowTenMin);
        const weekLogs = allLogs.filter(l => l.create_time >= weekStart && l.create_time <= nowTenMin);

        const sum = (logs: UsageLogEntity[]) =>
            Math.round(logs.reduce((acc, l) => acc + (l.inputTokens || 0) + (l.outputTokens || 0), 0) / 1000);

        return {
            today: sum(todayLogs),
            thisWeek: sum(weekLogs),
            total: sum(allLogs),
        };
    }
}
