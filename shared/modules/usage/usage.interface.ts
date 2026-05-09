import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { UsageLogEntity } from "./usage.entity";

export interface UsageAmountData {
    ts: number;
    amount: number;
}

export interface UsageStatsPeriod {
    /** Total usage for this period (hours) */
    total: number;
    /** Amount cumulative data */
    amounts: UsageAmountData[];
}

export interface UsageStatsResult {
    today: UsageStatsPeriod;
    last24h: UsageStatsPeriod;
    last7Days: UsageStatsPeriod;
}

export class UsageStatsRequest implements BaseRequest {
    public auth?: string;
    public modelAlias?: string;

    constructor(origin: Partial<UsageStatsRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.modelAlias && (this.modelAlias = origin.modelAlias);
    }
    static self(unsafe: UsageStatsRequest) {
        return new UsageStatsRequest(unsafe);
    }
}

export class UsageStatsResponse implements BaseResponse<UsageStatsPeriod> {
    public success: boolean;
    public message: string;
    public data: {
        today: UsageStatsPeriod;
        last24h: UsageStatsPeriod;
        last7Days: UsageStatsPeriod;
    };

    constructor(origin: UsageStatsResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class UsageDTO {
    public id: string;
    public accountId: string;
    public accountName?: string;
    public modelAlias: string;
    public providerId?: string;
    public providerName?: string;
    public inputTokens: number;
    public outputTokens: number;
    public tierSnapshot?: number | null;
    public create_time: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: UsageLogEntity & { accountName?: string; providerName?: string }) {
        this.id = origin.id;
        this.accountId = origin.accountId;
        this.accountName = origin.accountName;
        this.modelAlias = origin.modelAlias;
        this.providerId = origin.providerId;
        this.providerName = origin.providerName;
        this.inputTokens = origin.inputTokens;
        this.outputTokens = origin.outputTokens;
        this.tierSnapshot = origin.tierSnapshot;
        this.create_time = origin.create_time;
    }
}

export class UsageQueryBody {
    public accountId?: string;
    public modelAlias?: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<UsageLogEntity>) {
        if (false) throw new Error("Unexpected error");
        origin.accountId && (this.accountId = origin.accountId);
        origin.modelAlias && (this.modelAlias = origin.modelAlias);
    }

    static self(unsafe: Partial<UsageLogEntity>) {
        return new UsageQueryBody(unsafe);
    }
}

export class MyUsageRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<MyUsageRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: MyUsageRequest) {
        return new MyUsageRequest(unsafe);
    }
}

export class MyUsageResponse implements BaseResponse<any> {
    public success: boolean;
    public message: string;
    public data: {
        today: number;
        thisWeek: number;
        total: number;
    };

    constructor(origin: MyUsageResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class UsageListRequest implements BaseRequest {
    public auth?: string;
    public page: number;
    public filter?: UsageQueryBody;

    constructor(origin: Partial<UsageListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.filter && (this.filter = UsageQueryBody.self(origin.filter));
        this.page = Number(origin.page || 1);
    }
    static self(unsafe: UsageListRequest) {
        return new UsageListRequest(unsafe);
    }
}

export class UsageListResponse implements BaseResponse<UsageDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: UsageDTO[],
        total: number
    };

    constructor(origin: UsageListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// --- Session view types ---

export interface ProviderUsage {
    providerName: string;
    inputTokens: number;
    outputTokens: number;
}

export interface UserSession {
    startTime: number;
    endTime: number;
    modelAlias: string;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    tierSnapshot: number;
    providerUsage: ProviderUsage[];
    windowLabel: string;
}

export interface UserSessionGroup {
    accountId: string;
    accountName: string;
    sessions: UserSession[];
    totalTokens: number;
    totalRequests: number;
}

export class UsageSessionsRequest implements BaseRequest {
    public auth?: string;
    public gapMinutes?: number;
    public since?: number;

    constructor(origin: Partial<UsageSessionsRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.gapMinutes && (this.gapMinutes = origin.gapMinutes);
        origin.since && (this.since = origin.since);
    }
    static self(unsafe: UsageSessionsRequest) {
        return new UsageSessionsRequest(unsafe);
    }
}

export class UsageSessionsResponse implements BaseResponse<UserSessionGroup> {
    public success: boolean;
    public message: string;
    public data: UserSessionGroup[];

    constructor(origin: UsageSessionsResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}
