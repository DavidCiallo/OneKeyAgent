import {
    ProviderListRequest, ProviderListResponse,
    ProviderDetailRequest, ProviderDetailResponse,
    ProviderCreateRequest, ProviderCreateResponse,
    ProviderUpdateRequest, ProviderUpdateResponse,
    ProviderDeleteRequest, ProviderDeleteResponse,
    ProviderUpdatePriorityRequest, ProviderUpdatePriorityResponse,
} from "./provider.interface";

export const providerRoutes = {
    base: "/api",
    prefix: "/provider",
    list:           { path: "/list",           request: {} as ProviderListRequest,             response: {} as ProviderListResponse },
    detail:         { path: "/detail",         request: {} as ProviderDetailRequest,           response: {} as ProviderDetailResponse },
    create:         { path: "/create",         request: {} as ProviderCreateRequest,           response: {} as ProviderCreateResponse },
    update:         { path: "/update",         request: {} as ProviderUpdateRequest,           response: {} as ProviderUpdateResponse },
    updatepriority: { path: "/updatepriority", request: {} as ProviderUpdatePriorityRequest,   response: {} as ProviderUpdatePriorityResponse },
    delete:         { path: "/delete",         request: {} as ProviderDeleteRequest,           response: {} as ProviderDeleteResponse },
} as const;
