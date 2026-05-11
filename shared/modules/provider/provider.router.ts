import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    ProviderListRequest, ProviderListResponse,
    ProviderDetailRequest, ProviderDetailResponse,
    ProviderCreateRequest, ProviderCreateResponse,
    ProviderUpdateRequest, ProviderUpdateResponse,
    ProviderDeleteRequest, ProviderDeleteResponse,
    ProviderUpdatePriorityRequest, ProviderUpdatePriorityResponse,
} from "./provider.interface";

export class ProviderRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/provider";
    router = [
        { path: "/list", handler: Function },
        { path: "/detail", handler: Function },
        { path: "/create", handler: Function },
        { path: "/update", handler: Function },
        { path: "/updatepriority", handler: Function },
        { path: "/delete", handler: Function },
    ];

    list!: (query: ProviderListRequest) => Promise<ProviderListResponse>;
    detail!: (query: ProviderDetailRequest) => Promise<ProviderDetailResponse>;
    create!: (body: ProviderCreateRequest) => Promise<ProviderCreateResponse>;
    update!: (body: ProviderUpdateRequest) => Promise<ProviderUpdateResponse>;
    updatepriority!: (body: ProviderUpdatePriorityRequest) => Promise<ProviderUpdatePriorityResponse>;
    delete!: (body: ProviderDeleteRequest) => Promise<ProviderDeleteResponse>;

    constructor(inject: Function, functions?: {
        list: (query: ProviderListRequest) => Promise<ProviderListResponse>,
        detail: (query: ProviderDetailRequest) => Promise<ProviderDetailResponse>,
        create: (body: ProviderCreateRequest) => Promise<ProviderCreateResponse>,
        update: (body: ProviderUpdateRequest) => Promise<ProviderUpdateResponse>,
        updatepriority: (body: ProviderUpdatePriorityRequest) => Promise<ProviderUpdatePriorityResponse>,
        delete: (body: ProviderDeleteRequest) => Promise<ProviderDeleteResponse>
    }) {
        super();
        inject(this, functions);
    }
}
