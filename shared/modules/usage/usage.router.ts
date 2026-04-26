import { BaseRouterInstance } from "../../lib/default/decorator";
import { UsageListRequest, UsageListResponse, UsageStatsRequest, UsageStatsResponse, MyUsageRequest, MyUsageResponse } from "./usage.interface";

export class UsageRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/usage";
    router = [
        { path: "/list", handler: Function },
        { path: "/stats", handler: Function },
        { path: "/mystats", handler: Function },
    ];

    list!: (query: UsageListRequest) => Promise<UsageListResponse>;
    stats!: (query: UsageStatsRequest) => Promise<UsageStatsResponse>;
    mystats!: (query: MyUsageRequest) => Promise<MyUsageResponse>;

    constructor(inject: Function, functions?: {
        list: (query: UsageListRequest) => Promise<UsageListResponse>,
        stats: (query: UsageStatsRequest) => Promise<UsageStatsResponse>,
        mystats: (query: MyUsageRequest) => Promise<MyUsageResponse>,
    }) {
        super();
        inject(this, functions);
    }
}
