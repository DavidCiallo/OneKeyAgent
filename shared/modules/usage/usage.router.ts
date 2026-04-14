import { BaseRouterInstance } from "../../lib/default/decorator";
import { UsageListRequest, UsageListResponse, UsageStatsRequest, UsageStatsResponse } from "./usage.interface";

export class UsageRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/usage";
    router = [
        { path: "/list", handler: Function },
        { path: "/stats", handler: Function },
    ];

    list!: (query: UsageListRequest) => Promise<UsageListResponse>;
    stats!: (query: UsageStatsRequest) => Promise<UsageStatsResponse>;

    constructor(inject: Function, functions?: {
        list: (query: UsageListRequest) => Promise<UsageListResponse>,
        stats: (query: UsageStatsRequest) => Promise<UsageStatsResponse>,
    }) {
        super();
        inject(this, functions);
    }
}
