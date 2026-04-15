import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    RoleListRequest, RoleListResponse,
    RoleDetailRequest, RoleDetailResponse,
    RoleCreateRequest, RoleCreateResponse,
    RoleUpdateRequest, RoleUpdateResponse,
    RoleDeleteRequest, RoleDeleteResponse,
    AssignRolesRequest, AssignRolesResponse,
    AccountRolesRequest, AccountRolesResponse,
} from "./role.interface";

export class RoleRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/role";
    router = [
        { path: "/list", handler: Function },
        { path: "/detail", handler: Function },
        { path: "/create", handler: Function },
        { path: "/update", handler: Function },
        { path: "/delete", handler: Function },
        { path: "/assign", handler: Function },
        { path: "/account_roles", handler: Function },
    ];

    list!: (query: RoleListRequest) => Promise<RoleListResponse>;
    detail!: (query: RoleDetailRequest) => Promise<RoleDetailResponse>;
    create!: (body: RoleCreateRequest) => Promise<RoleCreateResponse>;
    update!: (body: RoleUpdateRequest) => Promise<RoleUpdateResponse>;
    delete!: (body: RoleDeleteRequest) => Promise<RoleDeleteResponse>;
    assign!: (body: AssignRolesRequest) => Promise<AssignRolesResponse>;
    account_roles!: (query: AccountRolesRequest) => Promise<AccountRolesResponse>;

    constructor(inject: Function, functions?: {
        list: (query: RoleListRequest) => Promise<RoleListResponse>,
        detail: (query: RoleDetailRequest) => Promise<RoleDetailResponse>,
        create: (body: RoleCreateRequest) => Promise<RoleCreateResponse>,
        update: (body: RoleUpdateRequest) => Promise<RoleUpdateResponse>,
        delete: (body: RoleDeleteRequest) => Promise<RoleDeleteResponse>,
        assign: (body: AssignRolesRequest) => Promise<AssignRolesResponse>,
        account_roles: (query: AccountRolesRequest) => Promise<AccountRolesResponse>,
    }) {
        super();
        inject(this, functions);
    }
}