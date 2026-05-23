import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { ProviderEntity } from "./provider.entity";

export class ProviderDTO {
    public id: string;
    public model_alias: string;
    public priority: number;
    public name: string;
    public base_url: string;
    public model: string;
    public api_key?: string;
    public auth_type?: string;
    public api_type?: string;
    public proxy_url?: string;
    public enabled: number;
    public create_time: number;
    public update_time: number | null;
    public delete_time: number | null;

    constructor(origin: ProviderEntity) {
        this.id = origin.id;
        this.model_alias = origin.model_alias;
        this.priority = origin.priority;
        this.name = origin.name;
        this.base_url = origin.base_url;
        this.model = origin.model;
        this.api_key = origin.api_key;
        this.auth_type = origin.auth_type;
        this.api_type = origin.api_type;
        this.proxy_url = origin.proxy_url;
        this.enabled = origin.enabled;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}

export class ProviderCreateBody {
    public model_alias: string;
    public priority: number;
    public name: string;
    public base_url: string;
    public model: string;
    public api_key?: string;
    public auth_type?: string;
    public api_type?: string;
    public proxy_url?: string;
    public enabled?: number;

    constructor(origin: Pick<ProviderEntity, "model_alias" | "base_url" | "model" | "priority" | "name"> & Partial<Pick<ProviderEntity, "api_key" | "auth_type" | "api_type" | "proxy_url" | "enabled">>) {
        if (!origin.model_alias || !origin.base_url || !origin.model || origin.priority === undefined) {
            throw new Error("model_alias, base_url, model and priority are required");
        }
        this.model_alias = origin.model_alias;
        this.priority = origin.priority;
        this.name = origin.name;
        this.base_url = origin.base_url;
        this.model = origin.model;
        this.api_key = origin.api_key;
        this.auth_type = origin.auth_type;
        this.api_type = origin.api_type;
        this.proxy_url = origin.proxy_url;
        this.enabled = origin.enabled ?? 1;
    }

    static self(unsafe: ProviderCreateBody) {
        return new ProviderCreateBody(unsafe);
    }
}

export class ProviderUpdateBody {
    public model_alias?: string;
    public priority?: number;
    public name?: string;
    public base_url?: string;
    public model?: string;
    public api_key?: string;
    public auth_type?: string;
    public api_type?: string;
    public proxy_url?: string;
    public enabled?: number;

    constructor(origin: Partial<ProviderEntity> = {}) {
        if (!origin.model_alias && origin.priority === undefined && !origin.base_url && !origin.model && !origin.api_key && origin.api_key === undefined && !origin.auth_type && !origin.api_type && !origin.proxy_url && origin.enabled === undefined) {
            throw new Error("At least one field is required");
        }
        origin.model_alias && (this.model_alias = origin.model_alias);
        origin.priority !== undefined && (this.priority = origin.priority);
        origin.name && (this.name = origin.name);
        origin.base_url && (this.base_url = origin.base_url);
        origin.model && (this.model = origin.model);
        origin.api_key !== undefined && (this.api_key = origin.api_key);
        origin.auth_type && (this.auth_type = origin.auth_type);
        origin.api_type && (this.api_type = origin.api_type);
        origin.proxy_url !== undefined && (this.proxy_url = origin.proxy_url);
        origin.enabled !== undefined && (this.enabled = origin.enabled);
    }

    static self(unsafe: ProviderUpdateBody) {
        return new ProviderUpdateBody(unsafe);
    }
}

export class ProviderQueryBody {
    public model_alias?: string;
    public enabled?: number;

    constructor(origin: Partial<ProviderEntity>) {
        if (false) throw new Error("Unexpected error");
        origin.model_alias && (this.model_alias = origin.model_alias);
        origin.enabled !== undefined && (this.enabled = origin.enabled);
    }

    static self(unsafe: Partial<ProviderEntity>) {
        return new ProviderQueryBody(unsafe);
    }
}

export class ProviderListRequest implements BaseRequest {
    public auth?: string;
    public page: number;
    public filter?: ProviderQueryBody;

    constructor(origin: Partial<ProviderListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.filter && (this.filter = ProviderQueryBody.self(origin.filter));
        this.page = Number(origin.page || 1);
    }
    static self(unsafe: ProviderListRequest) {
        return new ProviderListRequest(unsafe);
    }
}

export class ProviderListResponse implements BaseResponse<ProviderDTO> {
    public success: boolean;
    public message: string;
    public data: { list: ProviderDTO[], total: number };

    constructor(origin: ProviderListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class ProviderDetailRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: ProviderDetailRequest) {
        if (!origin.id) throw new Error("Id is required");
        this.id = origin.id;
    }
    static self(unsafe: ProviderDetailRequest) {
        return new ProviderDetailRequest(unsafe);
    }
}

export class ProviderDetailResponse implements BaseResponse<ProviderDTO> {
    public success: boolean;
    public message: string;
    public data: { provider: ProviderDTO | null };

    constructor(origin: ProviderDetailResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class ProviderCreateRequest implements BaseRequest {
    public auth?: string;
    public provider: ProviderCreateBody;

    constructor(origin: Partial<ProviderCreateRequest>) {
        if (!origin.provider) throw new Error("provider is required");
        origin.auth && (this.auth = origin.auth);
        this.provider = ProviderCreateBody.self(origin.provider);
    }
    static self(unsafe: ProviderCreateRequest) {
        return new ProviderCreateRequest(unsafe);
    }
}

export class ProviderCreateResponse implements BaseResponse<ProviderDTO> {
    public success: boolean;
    public message: string;
    public data: { provider: ProviderDTO | null };

    constructor(origin: ProviderCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class ProviderUpdateRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public provider: ProviderUpdateBody;

    constructor(origin: Partial<ProviderUpdateRequest>) {
        if (!origin.id || !origin.provider) throw new Error("id and provider are required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.provider = ProviderUpdateBody.self(origin.provider);
    }
    static self(unsafe: ProviderUpdateRequest) {
        return new ProviderUpdateRequest(unsafe);
    }
}

export class ProviderUpdateResponse implements BaseResponse<ProviderDTO> {
    public success: boolean;
    public message: string;
    public data: { provider: ProviderDTO | null };

    constructor(origin: ProviderUpdateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class ProviderSwapPriorityRequest implements BaseRequest {
    public auth?: string;
    public id1: string;
    public id2: string;

    constructor(origin: Partial<ProviderSwapPriorityRequest>) {
        if (!origin.id1 || !origin.id2) throw new Error("id1 and id2 are required");
        origin.auth && (this.auth = origin.auth);
        this.id1 = origin.id1;
        this.id2 = origin.id2;
    }
    static self(unsafe: ProviderSwapPriorityRequest) {
        return new ProviderSwapPriorityRequest(unsafe);
    }
}

export class ProviderSwapPriorityResponse implements BaseResponse<null> {
    public success: boolean;
    public message: string;

    constructor(origin: ProviderSwapPriorityResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}

export class ProviderDeleteRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<ProviderDeleteRequest>) {
        if (!origin.id) throw new Error("Id is required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
    }
    static self(unsafe: ProviderDeleteRequest) {
        return new ProviderDeleteRequest(unsafe);
    }
}

export class ProviderDeleteResponse implements BaseResponse<ProviderDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: ProviderDeleteResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}

export class ProviderUpdatePriorityRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public delta: number; // +1 or -1

    constructor(origin: Partial<ProviderUpdatePriorityRequest>) {
        if (!origin.id) throw new Error("id is required");
        if (!origin.delta) throw new Error("delta is required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.delta = origin.delta;
    }
    static self(unsafe: ProviderUpdatePriorityRequest) {
        return new ProviderUpdatePriorityRequest(unsafe);
    }
}

export class ProviderUpdatePriorityResponse implements BaseResponse<null> {
    public success: boolean;
    public message: string;

    constructor(origin: ProviderUpdatePriorityResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}
