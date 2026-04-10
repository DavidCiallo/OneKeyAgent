import { BaseRouterInstance } from "../../lib/default/decorator";
import { AccountListRequest, AccountListResponse, AccountDetailRequest, AccountDetailResponse, AccountCreateRequest, AccountCreateResponse, AccountUpdateRequest, AccountUpdateResponse, AccountDeleteRequest, AccountDeleteResponse } from "./account.interface";

export class AccountRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/account";
    router = [
        { path: "/list", handler: Function },
        { path: "/detail", handler: Function },
        { path: "/create", handler: Function },
        { path: "/update", handler: Function },
        { path: "/delete", handler: Function },
    ];

    list!: (query: AccountListRequest) => Promise<AccountListResponse>;
    detail!: (query: AccountDetailRequest) => Promise<AccountDetailResponse>;
    create!: (body: AccountCreateRequest) => Promise<AccountCreateResponse>;
    update!: (body: AccountUpdateRequest) => Promise<AccountUpdateResponse>;
    delete!: (body: AccountDeleteRequest) => Promise<AccountDeleteResponse>;

    constructor(inject: Function, functions?: {
        list: (query: AccountListRequest) => Promise<AccountListResponse>,
        detail: (query: AccountDetailRequest) => Promise<AccountDetailResponse>,
        create: (body: AccountCreateRequest) => Promise<AccountCreateResponse>,
        update: (body: AccountUpdateRequest) => Promise<AccountUpdateResponse>,
        delete: (body: AccountDeleteRequest) => Promise<AccountDeleteResponse>
    }) {
        super();
        inject(this, functions);
    }
}