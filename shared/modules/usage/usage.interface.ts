import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { UsageBucketEntity } from "./usage_bucket.entity";

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
    public model_alias?: string;

    constructor(origin: Partial<UsageStatsRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.model_alias && (this.model_alias = origin.model_alias);
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
    public account_id: string;
    public accountName?: string;
    public model_alias: string;
    public provider_id?: string;
    public providerName?: string;
    public input_tokens: number;
    public output_tokens: number;
    public cost: number;
    public create_time: number;

    constructor(origin: UsageBucketEntity & { accountName?: string; providerName?: string; cost?: number }) {
        this.id = origin.id;
        this.account_id = origin.account_id;
        this.accountName = origin.accountName;
        this.model_alias = origin.model_alias;
        this.provider_id = origin.provider_id;
        this.providerName = origin.providerName;
        this.input_tokens = origin.input_tokens;
        this.output_tokens = origin.output_tokens;
        this.cost = origin.cost ?? 0;
        this.create_time = origin.create_time;
    }
}

export class UsageQueryBody {
    public account_id?: string;
    public model_alias?: string;

    constructor(origin: Partial<UsageBucketEntity>) {
        if (false) throw new Error("Unexpected error");
        origin.account_id && (this.account_id = origin.account_id);
        origin.model_alias && (this.model_alias = origin.model_alias);
    }

    static self(unsafe: Partial<UsageBucketEntity>) {
        return new UsageQueryBody(unsafe);
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
    input_tokens: number;
    output_tokens: number;
}

export interface ModelUsage {
    model_alias: string;
    input_tokens: number;
    output_tokens: number;
}

export interface UserSession {
    startTime: number;
    endTime: number;
    model_aliases: string[];
    requestCount: number;
    input_tokens: number;
    output_tokens: number;
    cost: number;
    providerUsage: ProviderUsage[];
    modelUsage: ModelUsage[];
    windowLabel: string;
    accountName?: string;
}

export interface UserSessionGroup {
    account_id: string;
    accountName: string;
    sessions: UserSession[];
    totalTokens: number;
    totalRequests: number;
}

export class UsageSessionsRequest implements BaseRequest {
    public auth?: string;
    public gapMinutes?: number;
    public since?: number;
    public account_ids?: string[];

    constructor(origin: Partial<UsageSessionsRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.gapMinutes && (this.gapMinutes = origin.gapMinutes);
        origin.since && (this.since = origin.since);
        origin.account_ids && (this.account_ids = origin.account_ids);
    }
    static self(unsafe: UsageSessionsRequest) {
        return new UsageSessionsRequest(unsafe);
    }
}

export interface UsageSessionTotals {
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
}

// --- Batch stats types ---

export class UsageStatsBatchRequest implements BaseRequest {
    public auth?: string;
    public model_aliases: string[];

    constructor(origin: Partial<UsageStatsBatchRequest>) {
        if (!origin.model_aliases || origin.model_aliases.length === 0) throw new Error("model_aliases is required");
        origin.auth && (this.auth = origin.auth);
        this.model_aliases = origin.model_aliases;
    }
    static self(unsafe: UsageStatsBatchRequest) {
        return new UsageStatsBatchRequest(unsafe);
    }
}

export class UsageStatsBatchResponse implements BaseResponse<UsageStatsResult> {
    public success: boolean;
    public message: string;
    public data: Record<string, UsageStatsResult>;

    constructor(origin: UsageStatsBatchResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

