import { BaseRouterInstance } from "../../lib/default/decorator";
import { UsageListRequest, UsageListResponse, UsageStatsRequest, UsageStatsResponse, MyUsageRequest, MyUsageResponse, UsageSessionsRequest, UsageSessionsResponse } from "./usage.interface";

export class UsageRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/usage";
    router = [
        { path: "/list", handler: Function },
        { path: "/stats", handler: Function },
        { path: "/mystats", handler: Function },
        { path: "/sessions", handler: Function },
    ];

    list!: (query: UsageListRequest) => Promise<UsageListResponse>;
    stats!: (query: UsageStatsRequest) => Promise<UsageStatsResponse>;
    mystats!: (query: MyUsageRequest) => Promise<MyUsageResponse>;
    sessions!: (query: UsageSessionsRequest) => Promise<UsageSessionsResponse>;

    constructor(inject: Function, functions?: {
        list: (query: UsageListRequest) => Promise<UsageListResponse>,
        stats: (query: UsageStatsRequest) => Promise<UsageStatsResponse>,
        mystats: (query: MyUsageRequest) => Promise<MyUsageResponse>,
        sessions: (query: UsageSessionsRequest) => Promise<UsageSessionsResponse>,
    }) {
        super();
        inject(this, functions);
    }
}
