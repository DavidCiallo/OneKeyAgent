import { UsageListRequest, UsageListResponse, UsageStatsRequest, UsageStatsResponse, UsageSessionsRequest, UsageSessionsResponse } from "./usage.interface";

export const usageRoutes = {
    base: "/api",
    prefix: "/usage",
    list:     { path: "/list",     request: {} as UsageListRequest,     response: {} as UsageListResponse },
    stats:    { path: "/stats",    request: {} as UsageStatsRequest,    response: {} as UsageStatsResponse },
    sessions: { path: "/sessions", request: {} as UsageSessionsRequest, response: {} as UsageSessionsResponse },
} as const;
