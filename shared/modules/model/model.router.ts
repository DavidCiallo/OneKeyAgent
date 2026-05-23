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

export const modelRoutes = {
    base: "/api",
    prefix: "/model",
    list:   { path: "/list",   request: {} as ModelListRequest,   response: {} as ModelListResponse },
    detail: { path: "/detail", request: {} as ModelDetailRequest, response: {} as ModelDetailResponse },
    create: { path: "/create", request: {} as ModelCreateRequest, response: {} as ModelCreateResponse },
    update: { path: "/update", request: {} as ModelUpdateRequest, response: {} as ModelUpdateResponse },
    delete: { path: "/delete", request: {} as ModelDeleteRequest, response: {} as ModelDeleteResponse },
} as const;
