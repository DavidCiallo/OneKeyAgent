import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { ModelEntity } from "./model.entity";

export class ModelDTO {
    public id: string;
    public alias: string;
    public input_price: number;
    public cache_price: number;
    public output_price: number;
    public is_public: number;
    public create_time: number;
    public update_time: number | null;
    public delete_time: number | null;

    constructor(origin: ModelEntity) {
        this.id = origin.id;
        this.alias = origin.alias;
        this.input_price = origin.input_price;
        this.cache_price = origin.cache_price;
        this.output_price = origin.output_price;
        this.is_public = origin.is_public;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}

export class ModelQueryBody {
    public alias?: string;
    public is_public?: number;

    constructor(origin: Partial<ModelEntity>) {
        if (false) throw new Error("Unexpected error");
        origin.alias && (this.alias = origin.alias);
        origin.is_public !== undefined && (this.is_public = origin.is_public);
    }

    static self(unsafe: Partial<ModelEntity>) {
        return new ModelQueryBody(unsafe);
    }
}

export class ModelCreateBody {
    public alias: string;
    public input_price: number;
    public cache_price: number;
    public output_price: number;
    public is_public: number;

    constructor(origin: Pick<ModelEntity, "alias"> & Partial<Pick<ModelEntity, "input_price" | "cache_price" | "output_price" | "is_public">>) {
        if (!origin.alias) {
            throw new Error("alias is required");
        }
        this.alias = origin.alias;
        this.input_price = origin.input_price ?? 0;
        this.cache_price = origin.cache_price ?? 0;
        this.output_price = origin.output_price ?? 0;
        this.is_public = origin.is_public ?? 0;
    }

    static self(unsafe: ModelCreateBody) {
        return new ModelCreateBody(unsafe);
    }
}

export class ModelUpdateBody {
    public alias?: string;
    public input_price?: number;
    public cache_price?: number;
    public output_price?: number;
    public is_public?: number;

    constructor(origin: Partial<ModelEntity> = {}) {
        if (!origin.alias && origin.input_price === undefined && origin.cache_price === undefined && origin.output_price === undefined && origin.is_public === undefined) {
            throw new Error("At least one field is required");
        }
        origin.alias && (this.alias = origin.alias);
        origin.input_price !== undefined && (this.input_price = origin.input_price);
        origin.cache_price !== undefined && (this.cache_price = origin.cache_price);
        origin.output_price !== undefined && (this.output_price = origin.output_price);
        origin.is_public !== undefined && (this.is_public = origin.is_public);
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
