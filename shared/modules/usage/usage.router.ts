import type { UserSessionGroup, UsageSessionTotals, UserSession } from "./usage.interface";
import { UsageListRequest, UsageListResponse, UsageStatsRequest, UsageStatsResponse, UsageSessionsRequest, UsageStatsBatchRequest, UsageStatsBatchResponse } from "./usage.interface";

export const usageRoutes = {
    base: "/api",
    prefix: "/usage",
    list:     { path: "/list",     request: {} as UsageListRequest,     response: {} as UsageListResponse },
    stats:    { path: "/stats",    request: {} as UsageStatsRequest,    response: {} as UsageStatsResponse },
    sessions: { path: "/sessions", request: {} as UsageSessionsRequest, response: {} as { success: boolean; message: string; data: { list: UserSessionGroup[]; totals: UsageSessionTotals; recentSessions: UserSession[] } } },
    statsBatch: { path: "/stats/batch", request: {} as UsageStatsBatchRequest, response: {} as UsageStatsBatchResponse },
} as const;
