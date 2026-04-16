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
    AccountProfileRequest,
    AccountProfileResponse,
    AccountRegenerateRequest,
    AccountRegenerateResponse,
} from "../../../shared/modules/account/account.interface";
import { AccountRouterInstance } from "../../../shared/modules/account/account.router"
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, getAccountByEmail, registerUser } from "../auth/auth.service";
import { AccountService } from "./account.service";
import { generateApiKey } from "../ai/ai.auth";

async function requireAdmin(auth?: string): Promise<void> {
    if (!auth) throw "Authorization failed";
    const email = getIdentifyByVerify(auth);
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account || !account.is_admin) throw "Permission denied";
}

async function list(request: AccountListRequest): Promise<AccountListResponse> {
    request = AccountListRequest.self(request);
    const { page, auth } = request;
    await requireAdmin(auth);

    const search: Partial<AccountEntity> = {}
    if (request.filter?.name) search.name = request.filter.name;
    if (request.filter?.email) search.email = request.filter.email;

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
    await requireAdmin(request.auth);

    const existing = await AccountService.findByEmail(request.account.email);
    if (existing) throw "email already exists";

    const { account } = await registerUser(request.account.name, request.account.email, request.account.password, request.account.is_admin);
    if (!account) throw "create failed";
    const data = new AccountDTO(account);
    return new AccountCreateResponse({
        success: true,
        data: { account: data },
        message: "success"
    });
}

async function update(request: AccountUpdateRequest): Promise<AccountUpdateResponse> {
    request = AccountUpdateRequest.self(request);
    await requireAdmin(request.auth);

    if (request.account.email) {
        const existing = await AccountService.findByEmail(request.account.email);
        if (existing && existing.id !== request.id) throw "email already exists";
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
    await requireAdmin(request.auth);
    if (!request.id) {
        throw "Delete wrong"
    }
    await AccountService.delete(request.id);
    return new AccountDeleteResponse({
        success: true,
        message: "success"
    });
}

async function profile(request: AccountProfileRequest): Promise<AccountProfileResponse> {
    request = AccountProfileRequest.self(request);
    const email = getIdentifyByVerify(request.auth || "");
    if (!email) throw new Error("Unauthorized");
    const account = await getAccountByEmail(email);
    if (!account) throw new Error("Account not found");
    return new AccountProfileResponse({
        success: true,
        message: "success",
        data: { account: new AccountDTO(account) },
    });
}

async function regenerate(request: AccountRegenerateRequest): Promise<AccountRegenerateResponse> {
    request = AccountRegenerateRequest.self(request);
    const email = getIdentifyByVerify(request.auth || "");
    if (!email) throw new Error("Unauthorized");
    const account = await getAccountByEmail(email);
    if (!account) throw new Error("Account not found");
    const newApiKey = generateApiKey();
    await AccountService.update(account.id, { apiKey: newApiKey });
    return new AccountRegenerateResponse({
        success: true,
        message: "success",
        data: { apiKey: newApiKey },
    });
}

export const accountController = new AccountRouterInstance(inject, { list, detail, create, update, delete: del, profile, regenerate });
