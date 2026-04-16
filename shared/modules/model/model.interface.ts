import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { ModelEntity } from "./model.entity";

export class ModelDTO {
    public id: string;
    public tier: number;
    public baseURL: string;
    public model: string;
    public alias?: string;
    public apiKey?: string;
    public proxyURL?: string;
    public create_time: number;
    public update_time: number;
    public delete_time: number | null;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: ModelEntity) {
        this.id = origin.id;
        this.tier = origin.tier;
        this.baseURL = origin.baseURL;
        this.model = origin.model;
        this.alias = origin.alias;
        this.apiKey = origin.apiKey;
        this.proxyURL = origin.proxyURL;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}

export class ModelQueryBody {
    public id?: string;
    public tier?: number;
    public baseURL?: string;
    public model?: string;
    public alias?: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<ModelEntity>) {
        if (false) throw new Error("Unexpected error");
        origin.id && (this.id = origin.id);
        origin.tier && (this.tier = origin.tier);
        origin.baseURL && (this.baseURL = origin.baseURL);
        origin.model && (this.model = origin.model);
        origin.alias && (this.alias = origin.alias);
    }

    static self(unsafe: Partial<ModelEntity>) {
        return new ModelQueryBody(unsafe);
    }
}

export class ModelCreateBody {
    public tier: number;
    public baseURL: string;
    public model: string;
    public alias?: string;
    public apiKey?: string;
    public proxyURL?: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Pick<ModelEntity, "tier" | "baseURL" | "model"> & Partial<Pick<ModelEntity, "alias" | "apiKey" | "proxyURL">>) {
        if (!origin.tier || !origin.baseURL || !origin.model) {
            throw new Error("tier, baseURL and model are required");
        }
        this.tier = origin.tier;
        this.baseURL = origin.baseURL;
        this.model = origin.model;
        this.alias = origin.alias;
        this.apiKey = origin.apiKey;
        this.proxyURL = origin.proxyURL;
    }

    static self(unsafe: ModelCreateBody) {
        return new ModelCreateBody(unsafe);
    }
}

export class ModelUpdateBody {
    public tier?: number;
    public baseURL?: string;
    public model?: string;
    public alias?: string;
    public apiKey?: string;
    public proxyURL?: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<ModelEntity> = {}) {
        if (!origin.tier && !origin.baseURL && !origin.model && !origin.alias && !origin.apiKey && !origin.proxyURL) {
            throw new Error("At least one field is required");
        }
        origin.tier !== undefined && (this.tier = origin.tier);
        origin.baseURL && (this.baseURL = origin.baseURL);
        origin.model && (this.model = origin.model);
        origin.alias !== undefined && (this.alias = origin.alias);
        origin.apiKey !== undefined && (this.apiKey = origin.apiKey);
        origin.proxyURL !== undefined && (this.proxyURL = origin.proxyURL);
    }

    static self(unsafe: ModelUpdateBody) {
        return new ModelUpdateBody(unsafe);
    }
}

export class ModelListRequest implements BaseRequest {
    public auth?: string;
    public page: number;
    public filter?: ModelQueryBody;

    constructor(origin: Partial<ModelListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.filter && (this.filter = ModelQueryBody.self(origin.filter));
        this.page = Number(origin.page || 1);
    }
    static self(unsafe: ModelListRequest) {
        return new ModelListRequest(unsafe);
    }
}

export class ModelListResponse implements BaseResponse<ModelDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: ModelDTO[],
        total: number
    };

    constructor(origin: ModelListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class ModelDetailRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: ModelDetailRequest) {
        if (!origin.id) {
            throw new Error("Id is required");
        }
        this.id = origin.id;
    }
    static self(unsafe: ModelDetailRequest) {
        return new ModelDetailRequest(unsafe);
    }
}

export class ModelDetailResponse implements BaseResponse<ModelDTO> {
    public success: boolean;
    public message: string;
    public data: {
        model: ModelDTO | null
    };

    constructor(origin: ModelDetailResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class ModelCreateRequest implements BaseRequest {
    public auth?: string;
    public model: ModelCreateBody;

    constructor(origin: Partial<ModelCreateRequest>) {
        if (!origin.model) throw new Error("model is required");
        origin.auth && (this.auth = origin.auth);
        this.model = ModelCreateBody.self(origin.model);
    }
    static self(unsafe: ModelCreateRequest) {
        return new ModelCreateRequest(unsafe);
    }
}

export class ModelCreateResponse implements BaseResponse<ModelDTO> {
    public success: boolean;
    public message: string;
    public data: {
        model: ModelDTO | null
    };

    constructor(origin: ModelCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class ModelUpdateRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public model: ModelUpdateBody;

    constructor(origin: Partial<ModelUpdateRequest>) {
        if (!origin.id || !origin.model) throw new Error("id and model are required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.model = ModelUpdateBody.self(origin.model);
    }
    static self(unsafe: ModelUpdateRequest) {
        return new ModelUpdateRequest(unsafe);
    }
}

export class ModelUpdateResponse implements BaseResponse<ModelDTO> {
    public success: boolean;
    public message: string;
    public data: {
        model: ModelDTO | null
    };

    constructor(origin: ModelUpdateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class ModelDeleteRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<ModelDeleteRequest>) {
        if (!origin.id) throw new Error("Id is required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
    }
    static self(unsafe: ModelDeleteRequest) {
        return new ModelDeleteRequest(unsafe);
    }
}

export class ModelDeleteResponse implements BaseResponse<ModelDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: ModelDeleteResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}
