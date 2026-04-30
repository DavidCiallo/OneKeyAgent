import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    ProviderListRequest, ProviderListResponse,
    ProviderDetailRequest, ProviderDetailResponse,
    ProviderCreateRequest, ProviderCreateResponse,
    ProviderUpdateRequest, ProviderUpdateResponse,
    ProviderDeleteRequest, ProviderDeleteResponse,
} from "./provider.interface";

export class ProviderRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/provider";
    router = [
        { path: "/list", handler: Function },
        { path: "/detail", handler: Function },
        { path: "/create", handler: Function },
        { path: "/update", handler: Function },
        { path: "/delete", handler: Function },
    ];

    list!: (query: ProviderListRequest) => Promise<ProviderListResponse>;
    detail!: (query: ProviderDetailRequest) => Promise<ProviderDetailResponse>;
    create!: (body: ProviderCreateRequest) => Promise<ProviderCreateResponse>;
    update!: (body: ProviderUpdateRequest) => Promise<ProviderUpdateResponse>;
    delete!: (body: ProviderDeleteRequest) => Promise<ProviderDeleteResponse>;

    constructor(inject: Function, functions?: {
        list: (query: ProviderListRequest) => Promise<ProviderListResponse>,
        detail: (query: ProviderDetailRequest) => Promise<ProviderDetailResponse>,
        create: (body: ProviderCreateRequest) => Promise<ProviderCreateResponse>,
        update: (body: ProviderUpdateRequest) => Promise<ProviderUpdateResponse>,
        delete: (body: ProviderDeleteRequest) => Promise<ProviderDeleteResponse>
    }) {
        super();
        inject(this, functions);
    }
}
