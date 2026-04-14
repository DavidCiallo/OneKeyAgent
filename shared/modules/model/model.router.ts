import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    ModelListRequest,
    ModelListResponse,
    ModelDetailRequest,
    ModelDetailResponse,
    ModelCreateRequest,
    ModelCreateResponse,
    ModelUpdateRequest,
    ModelUpdateResponse,
    ModelDeleteRequest,
    ModelDeleteResponse,
} from "./model.interface";

export class ModelRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/model";
    router = [
        { path: "/list", handler: Function },
        { path: "/detail", handler: Function },
        { path: "/create", handler: Function },
        { path: "/update", handler: Function },
        { path: "/delete", handler: Function },
    ];

    list!: (query: ModelListRequest) => Promise<ModelListResponse>;
    detail!: (query: ModelDetailRequest) => Promise<ModelDetailResponse>;
    create!: (body: ModelCreateRequest) => Promise<ModelCreateResponse>;
    update!: (body: ModelUpdateRequest) => Promise<ModelUpdateResponse>;
    delete!: (body: ModelDeleteRequest) => Promise<ModelDeleteResponse>;

    constructor(inject: Function, functions?: {
        list: (query: ModelListRequest) => Promise<ModelListResponse>,
        detail: (query: ModelDetailRequest) => Promise<ModelDetailResponse>,
        create: (body: ModelCreateRequest) => Promise<ModelCreateResponse>,
        update: (body: ModelUpdateRequest) => Promise<ModelUpdateResponse>,
        delete: (body: ModelDeleteRequest) => Promise<ModelDeleteResponse>
    }) {
        super();
        inject(this, functions);
    }
}
