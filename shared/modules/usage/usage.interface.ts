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
    public modelId?: string;

    constructor(origin: Partial<UsageStatsRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.modelId && (this.modelId = origin.modelId);
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
    public apiKey: string;
    public modelId: string;
    public inputTokens: number;
    public outputTokens: number;
    public create_time: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: UsageLogEntity) {
        this.id = origin.id;
        this.apiKey = origin.apiKey;
        this.modelId = origin.modelId;
        this.inputTokens = origin.inputTokens;
        this.outputTokens = origin.outputTokens;
        this.create_time = origin.create_time;
    }
}

export class UsageQueryBody {
    public apiKey?: string;
    public modelId?: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<UsageLogEntity>) {
        if (false) throw new Error("Unexpected error");
        origin.apiKey && (this.apiKey = origin.apiKey);
        origin.modelId && (this.modelId = origin.modelId);
    }

    static self(unsafe: Partial<UsageLogEntity>) {
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
