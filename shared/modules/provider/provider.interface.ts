import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { ProviderEntity } from "./provider.entity";

export class ProviderDTO {
    public id: string;
    public modelAlias: string;
    public priority: number;
    public name: string;
    public baseURL: string;
    public model: string;
    public apiKey?: string;
    public proxyURL?: string;
    public enabled: number;
    public create_time: number;
    public update_time: number | null;
    public delete_time: number | null;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: ProviderEntity) {
        this.id = origin.id;
        this.modelAlias = origin.modelAlias;
        this.priority = origin.priority;
        this.name = origin.name;
        this.baseURL = origin.baseURL;
        this.model = origin.model;
        this.apiKey = origin.apiKey;
        this.proxyURL = origin.proxyURL;
        this.enabled = origin.enabled;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}

export class ProviderCreateBody {
    public modelAlias: string;
    public priority: number;
    public name: string;
    public baseURL: string;
    public model: string;
    public apiKey?: string;
    public proxyURL?: string;
    public enabled?: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Pick<ProviderEntity, "modelAlias" | "baseURL" | "model" | "priority" | "name"> & Partial<Pick<ProviderEntity, "apiKey" | "proxyURL" | "enabled">>) {
        if (!origin.modelAlias || !origin.baseURL || !origin.model || origin.priority === undefined) {
            throw new Error("modelAlias, baseURL, model and priority are required");
        }
        this.modelAlias = origin.modelAlias;
        this.priority = origin.priority;
        this.name = origin.name;
        this.baseURL = origin.baseURL;
        this.model = origin.model;
        this.apiKey = origin.apiKey;
        this.proxyURL = origin.proxyURL;
        this.enabled = origin.enabled ?? 1;
    }

    static self(unsafe: ProviderCreateBody) {
        return new ProviderCreateBody(unsafe);
    }
}

export class ProviderUpdateBody {
    public modelAlias?: string;
    public priority?: number;
    public name?: string;
    public baseURL?: string;
    public model?: string;
    public apiKey?: string;
    public proxyURL?: string;
    public enabled?: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<ProviderEntity> = {}) {
        if (!origin.modelAlias && origin.priority === undefined && !origin.baseURL && !origin.model && !origin.apiKey && origin.apiKey === undefined && !origin.proxyURL && origin.enabled === undefined) {
            throw new Error("At least one field is required");
        }
        origin.modelAlias && (this.modelAlias = origin.modelAlias);
        origin.priority !== undefined && (this.priority = origin.priority);
        origin.name && (this.name = origin.name);
        origin.baseURL && (this.baseURL = origin.baseURL);
        origin.model && (this.model = origin.model);
        origin.apiKey !== undefined && (this.apiKey = origin.apiKey);
        origin.proxyURL !== undefined && (this.proxyURL = origin.proxyURL);
        origin.enabled !== undefined && (this.enabled = origin.enabled);
    }

    static self(unsafe: ProviderUpdateBody) {
        return new ProviderUpdateBody(unsafe);
    }
}

export class ProviderQueryBody {
    public modelAlias?: string;
    public enabled?: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<ProviderEntity>) {
        if (false) throw new Error("Unexpected error");
        origin.modelAlias && (this.modelAlias = origin.modelAlias);
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
