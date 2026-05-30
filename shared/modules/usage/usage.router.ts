import type { UserSessionGroup, UsageSessionTotals, UserSession } from "./usage.interface";
import { UsageListRequest, UsageListResponse, UsageStatsRequest, UsageStatsResponse, UsageSessionsRequest } from "./usage.interface";

export const usageRoutes = {
    base: "/api",
    prefix: "/usage",
    list:     { path: "/list",     request: {} as UsageListRequest,     response: {} as UsageListResponse },
    stats:    { path: "/stats",    request: {} as UsageStatsRequest,    response: {} as UsageStatsResponse },
    sessions: { path: "/sessions", request: {} as UsageSessionsRequest, response: {} as { success: boolean; message: string; data: { list: UserSessionGroup[]; totals: UsageSessionTotals; recentSessions: UserSession[] } } },
} as const;
