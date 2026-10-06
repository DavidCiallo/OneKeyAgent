import {
    AccountGroupListRequest, AccountGroupListResponse,
    AccountGroupDetailRequest, AccountGroupDetailResponse,
    AccountGroupCreateRequest, AccountGroupCreateResponse,
    AccountGroupUpdateRequest, AccountGroupUpdateResponse,
    AccountGroupDeleteRequest, AccountGroupDeleteResponse,
    AccountGroupAssignRequest, AccountGroupAssignResponse,
    AccountGroupsRequest, AccountGroupsResponse,
    SetAccountGroupsRequest, SetAccountGroupsResponse,
} from "./group.interface";

export const groupRoutes = {
    base: "/api",
    prefix: "/group",
    list:          { path: "/list",    request: {} as AccountGroupListRequest,    response: {} as AccountGroupListResponse },
    detail:        { path: "/detail",  request: {} as AccountGroupDetailRequest,  response: {} as AccountGroupDetailResponse },
    create:        { path: "/create",  request: {} as AccountGroupCreateRequest,  response: {} as AccountGroupCreateResponse },
    update:        { path: "/update",  request: {} as AccountGroupUpdateRequest,  response: {} as AccountGroupUpdateResponse },
    delete:        { path: "/delete",  request: {} as AccountGroupDeleteRequest,  response: {} as AccountGroupDeleteResponse },
    assign:        { path: "/assign",  request: {} as AccountGroupAssignRequest,  response: {} as AccountGroupAssignResponse },
    account_groups:     { path: "/account_groups",     request: {} as AccountGroupsRequest,     response: {} as AccountGroupsResponse },
    set_account_groups: { path: "/set_account_groups", request: {} as SetAccountGroupsRequest, response: {} as SetAccountGroupsResponse },
} as const;
