import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { SubscriptionPlanEntity } from "./subscription_plan.entity";

export class SubscriptionPlanDTO {
    public id: string;
    public name: string;
    public monthly_limit: number;
    public price: number;
    public duration_days: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: SubscriptionPlanEntity) {
        this.id = origin.id;
        this.name = origin.name;
        this.monthly_limit = origin.monthly_limit;
        this.price = origin.price;
        this.duration_days = origin.duration_days;
    }
}

export class SubscriptionPlanListRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<SubscriptionPlanListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: SubscriptionPlanListRequest) {
        return new SubscriptionPlanListRequest(unsafe);
    }
}

export class SubscriptionPlanListResponse implements BaseResponse<SubscriptionPlanDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: SubscriptionPlanDTO[]
    };

    constructor(origin: SubscriptionPlanListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class SubscriptionPlanCreateBody {
    public name: string;
    public monthly_limit: number;
    public price: number;
    public duration_days: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Pick<SubscriptionPlanEntity, "name" | "monthly_limit" | "price" | "duration_days">) {
        if (!origin.name) throw new Error("name is required");
        this.name = origin.name;
        this.monthly_limit = origin.monthly_limit;
        this.price = origin.price;
        this.duration_days = origin.duration_days;
    }

    static self(unsafe: SubscriptionPlanCreateBody) {
        return new SubscriptionPlanCreateBody(unsafe);
    }
}

export class SubscriptionPlanCreateRequest implements BaseRequest {
    public auth?: string;
    public plan: SubscriptionPlanCreateBody;

    constructor(origin: Partial<SubscriptionPlanCreateRequest>) {
        if (!origin.plan) throw new Error("plan is required");
        origin.auth && (this.auth = origin.auth);
        this.plan = SubscriptionPlanCreateBody.self(origin.plan);
    }
    static self(unsafe: SubscriptionPlanCreateRequest) {
        return new SubscriptionPlanCreateRequest(unsafe);
    }
}

export class SubscriptionPlanCreateResponse implements BaseResponse<SubscriptionPlanDTO> {
    public success: boolean;
    public message: string;
    public data: {
        plan: SubscriptionPlanDTO | null
    };

    constructor(origin: SubscriptionPlanCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class SubscriptionPlanUpdateBody {
    public name?: string;
    public monthly_limit?: number;
    public price?: number;
    public duration_days?: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<SubscriptionPlanEntity> = {}) {
        if (!origin.name && origin.monthly_limit === undefined && origin.price === undefined && origin.duration_days === undefined) {
            throw new Error("At least one field is required");
        }
        origin.name && (this.name = origin.name);
        origin.monthly_limit !== undefined && (this.monthly_limit = origin.monthly_limit);
        origin.price !== undefined && (this.price = origin.price);
        origin.duration_days !== undefined && (this.duration_days = origin.duration_days);
    }

    static self(unsafe: SubscriptionPlanUpdateBody) {
        return new SubscriptionPlanUpdateBody(unsafe);
    }
}

export class SubscriptionPlanUpdateRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public plan: SubscriptionPlanUpdateBody;

    constructor(origin: Partial<SubscriptionPlanUpdateRequest>) {
        if (!origin.id || !origin.plan) throw new Error("id and plan are required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.plan = SubscriptionPlanUpdateBody.self(origin.plan);
    }
    static self(unsafe: SubscriptionPlanUpdateRequest) {
        return new SubscriptionPlanUpdateRequest(unsafe);
    }
}

export class SubscriptionPlanUpdateResponse implements BaseResponse<SubscriptionPlanDTO> {
    public success: boolean;
    public message: string;
    public data: {
        plan: SubscriptionPlanDTO | null
    };

    constructor(origin: SubscriptionPlanUpdateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class SubscriptionPlanDeleteRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<SubscriptionPlanDeleteRequest>) {
        if (!origin.id) throw new Error("id is required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
    }
    static self(unsafe: SubscriptionPlanDeleteRequest) {
        return new SubscriptionPlanDeleteRequest(unsafe);
    }
}

export class SubscriptionPlanDeleteResponse implements BaseResponse<SubscriptionPlanDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: SubscriptionPlanDeleteResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}
