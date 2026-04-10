import { AccountEntity } from "../../../shared/modules/account/account.entity";
import {
    AccountDTO,
    AccountCreateRequest,
    AccountCreateResponse,
    AccountListRequest,
    AccountListResponse,
    AccountDetailRequest,
    AccountDetailResponse,
    AccountUpdateRequest,
    AccountUpdateResponse,
    AccountDeleteRequest,
    AccountDeleteResponse,
} from "../../../shared/modules/account/account.interface";
import { AccountRouterInstance } from "../../../shared/modules/account/account.router"
import { inject } from "../../lib/inject";
import { getIdentifyByVerify } from "../auth/auth.service";
import { AccountService } from "./account.service";

async function list(request: AccountListRequest): Promise<AccountListResponse> {
    request = AccountListRequest.self(request);
    const { page, auth, filter } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed"
    }

    const search: Partial<AccountEntity> = {}
    if (filter?.name) search.name = filter.name;
    if (filter?.email) search.email = filter.email;

    const { list: data, total } = await AccountService.find(page, search);
    const list = data.map(item => new AccountDTO(item));

    return new AccountListResponse({
        success: true,
        data: { list, total },
        message: "success"
    });
}

async function detail(request: AccountDetailRequest): Promise<AccountDetailResponse> {
    request = AccountDetailRequest.self(request);
    const { id, auth } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed"
    }
    const data = await AccountService.findOne(id);
    if (!data) {
        throw "account not found";
    }
    const account = new AccountDTO(data);
    return new AccountDetailResponse({
        success: true,
        data: { account },
        message: "success"
    })
}

async function create(request: AccountCreateRequest): Promise<AccountCreateResponse> {
    request = AccountCreateRequest.self(request);
    if (!request.account) {
        throw "miss params";
    }
    const { auth } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed"
    }
    const data = await AccountService.create(request.account);
    if (!data) throw "create failed";
    const account = new AccountDTO(data);
    return new AccountCreateResponse({
        success: true,
        data: { account },
        message: "success"
    });
}

async function update(request: AccountUpdateRequest): Promise<AccountUpdateResponse> {
    request = AccountUpdateRequest.self(request);
    const { auth } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed"
    }
    if (!request || !request.id || !request.account) {
        throw "miss params";
    }
    const data = await AccountService.update(request.id, request.account);
    if (!data) {
        throw "update failed";
    }
    const account = new AccountDTO(data);
    return new AccountUpdateResponse({
        success: true,
        data: { account },
        message: "success"
    });
}

async function del(request: AccountDeleteRequest): Promise<AccountDeleteResponse> {
    request = AccountDeleteRequest.self(request);
    if (!request) {
        throw "Delete wrong"
    }
    await AccountService.delete(request.id);
    return new AccountDeleteResponse({
        success: true,
        message: "success"
    });
}

export const accountController = new AccountRouterInstance(inject, { list, detail, create, update, delete: del });
