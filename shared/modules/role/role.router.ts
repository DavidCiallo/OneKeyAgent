import {
    RoleListRequest, RoleListResponse,
    RoleDetailRequest, RoleDetailResponse,
    RoleCreateRequest, RoleCreateResponse,
    RoleUpdateRequest, RoleUpdateResponse,
    RoleDeleteRequest, RoleDeleteResponse,
    AssignRolesRequest, AssignRolesResponse,
    AccountRolesRequest, AccountRolesResponse,
} from "./role.interface";

export const roleRoutes = {
    base: "/api",
    prefix: "/role",
    list:          { path: "/list",          request: {} as RoleListRequest,          response: {} as RoleListResponse },
    detail:        { path: "/detail",        request: {} as RoleDetailRequest,        response: {} as RoleDetailResponse },
    create:        { path: "/create",        request: {} as RoleCreateRequest,        response: {} as RoleCreateResponse },
    update:        { path: "/update",        request: {} as RoleUpdateRequest,        response: {} as RoleUpdateResponse },
    delete:        { path: "/delete",        request: {} as RoleDeleteRequest,        response: {} as RoleDeleteResponse },
    assign:        { path: "/assign",        request: {} as AssignRolesRequest,       response: {} as AssignRolesResponse },
    account_roles: { path: "/account_roles", request: {} as AccountRolesRequest,      response: {} as AccountRolesResponse },
} as const;
