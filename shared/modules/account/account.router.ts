import { BaseRouterInstance } from "../../lib/default/decorator";
import { AccountListRequest, AccountListResponse, AccountDetailRequest, AccountDetailResponse, AccountCreateRequest, AccountCreateResponse, AccountUpdateRequest, AccountUpdateResponse, AccountDeleteRequest, AccountDeleteResponse, AccountProfileRequest, AccountProfileResponse, AccountRegenerateRequest, AccountRegenerateResponse } from "./account.interface";

export class AccountRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/account";
    router = [
        { path: "/list", handler: Function },
        { path: "/detail", handler: Function },
        { path: "/create", handler: Function },
        { path: "/update", handler: Function },
        { path: "/delete", handler: Function },
        { path: "/profile", handler: Function },
        { path: "/regenerate", handler: Function },
    ];

    list!: (query: AccountListRequest) => Promise<AccountListResponse>;
    detail!: (query: AccountDetailRequest) => Promise<AccountDetailResponse>;
    create!: (body: AccountCreateRequest) => Promise<AccountCreateResponse>;
    update!: (body: AccountUpdateRequest) => Promise<AccountUpdateResponse>;
    delete!: (body: AccountDeleteRequest) => Promise<AccountDeleteResponse>;
    profile!: (query: AccountProfileRequest) => Promise<AccountProfileResponse>;
    regenerate!: (query: AccountRegenerateRequest) => Promise<AccountRegenerateResponse>;

    constructor(inject: Function, functions?: {
        list: (query: AccountListRequest) => Promise<AccountListResponse>,
        detail: (query: AccountDetailRequest) => Promise<AccountDetailResponse>,
        create: (body: AccountCreateRequest) => Promise<AccountCreateResponse>,
        update: (body: AccountUpdateRequest) => Promise<AccountUpdateResponse>,
        delete: (body: AccountDeleteRequest) => Promise<AccountDeleteResponse>,
        profile: (query: AccountProfileRequest) => Promise<AccountProfileResponse>,
        regenerate: (query: AccountRegenerateRequest) => Promise<AccountRegenerateResponse>,
    }) {
        super();
        inject(this, functions);
    }
}