import { AccountListRequest, AccountListResponse, AccountDetailRequest, AccountDetailResponse, AccountCreateRequest, AccountCreateResponse, AccountUpdateRequest, AccountUpdateResponse, AccountDeleteRequest, AccountDeleteResponse, AccountProfileRequest, AccountProfileResponse, AccountRegenerateRequest, AccountRegenerateResponse, AccountExportRequest, AccountExportResponse, AccountImportRequest, AccountImportResponse } from "./account.interface";

export const accountRoutes = {
    base: "/api",
    prefix: "/account",
    list: { path: "/list", request: {} as AccountListRequest, response: {} as AccountListResponse },
    detail: { path: "/detail", request: {} as AccountDetailRequest, response: {} as AccountDetailResponse },
    create: { path: "/create", request: {} as AccountCreateRequest, response: {} as AccountCreateResponse },
    update: { path: "/update", request: {} as AccountUpdateRequest, response: {} as AccountUpdateResponse },
    delete: { path: "/delete", request: {} as AccountDeleteRequest, response: {} as AccountDeleteResponse },
    profile: { path: "/profile", request: {} as AccountProfileRequest, response: {} as AccountProfileResponse },
    regenerate: { path: "/regenerate", request: {} as AccountRegenerateRequest, response: {} as AccountRegenerateResponse },
    export: { path: "/export", request: {} as AccountExportRequest, response: {} as AccountExportResponse },
    import: { path: "/import", request: {} as AccountImportRequest, response: {} as AccountImportResponse },
} as const;
