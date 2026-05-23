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
    AccountExportRequest,
    AccountExportResponse,
    AccountImportRequest,
    AccountImportResponse,
} from "../../../shared/modules/account/account.interface";
import { AccountRouterInstance } from "../../../shared/modules/account/account.router"
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, getAccountByEmail, requireAdmin } from "../auth/auth.service";
import { AccountService } from "./account.service";
import { generateApiKey } from "../ai/ai.auth";
import Repository from "../../lib/repository";
import { hashGenerate } from "../../methods/crypto";

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
    await requireAdmin(auth);
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

    const api_key = generateApiKey();
    const account = await AccountService.create({
        name: request.account.name,
        email: request.account.email,
        password: hashGenerate(request.account.password),
        api_key,
        is_admin: request.account.is_admin || 0,
    });
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

    // Calculate weekly usage cost
    const since = Date.now() - 7 * 86400000;
    const usageRepo = Repository.instance<any>("usage_log");
    const logs = await usageRepo.find({ account_id: account.id }, { since });

    return new AccountProfileResponse({
        success: true,
        message: "success",
        data: {
            account: new AccountDTO(account),
            weeklyUsage: AccountService.computeUsageCost(logs),
            balance: account.balance,
        },
    });
}

async function regenerate(request: AccountRegenerateRequest): Promise<AccountRegenerateResponse> {
    request = AccountRegenerateRequest.self(request);
    const email = getIdentifyByVerify(request.auth || "");
    if (!email) throw new Error("Unauthorized");
    const account = await getAccountByEmail(email);
    if (!account) throw new Error("Account not found");
    const newApiKey = generateApiKey();
    await AccountService.update(account.id, { api_key: newApiKey });
    return new AccountRegenerateResponse({
        success: true,
        message: "success",
        data: { api_key: newApiKey },
    });
}

// ========== Export / Import ==========

async function exportData(request: AccountExportRequest): Promise<AccountExportResponse> {
    await requireAdmin(request.auth);

    const accountRepo = Repository.instance<any>("Account");
    const modelRepo = Repository.instance<any>("Model");
    const providerRepo = Repository.instance<any>("Provider");
    const roleRepo = Repository.instance<any>("Role");
    const accountRoleRepo = Repository.instance<any>("account_role");
    const recordRepo = Repository.instance<any>("Transaction");
    const taskRepo = Repository.instance<any>("Task");
    const usageRepo = Repository.instance<any>("usage_log");
    const giftCardRepo = Repository.instance<any>("gift_card");

    // Small tables: load all at once
    const [accounts, models, providers, roles, accountRoles, tasks, giftCards] = await Promise.all([
        accountRepo.findAllIgnoreDelete(),
        modelRepo.findAllIgnoreDelete(),
        providerRepo.findAllIgnoreDelete(),
        roleRepo.findAllIgnoreDelete(),
        accountRoleRepo.findAllIgnoreDelete(),
        taskRepo.findAllIgnoreDelete(),
        giftCardRepo.findAllIgnoreDelete(),
    ]);

    // Large tables: batch read to avoid OOM
    const transactions: any[] = [];
    for await (const batch of recordRepo.findAllIgnoreDeleteBatch(2000)) {
        transactions.push(...batch);
    }
    const usageLogs: any[] = [];
    for await (const batch of usageRepo.findAllIgnoreDeleteBatch(2000)) {
        usageLogs.push(...batch);
    }

    return new AccountExportResponse({
        success: true,
        message: "success",
        data: {
            version: 1,
            exported_at: Date.now(),
            data: {
                accounts: accounts || [],
                models: models || [],
                providers: providers || [],
                roles: roles || [],
                account_roles: accountRoles || [],
                transactions,
                tasks: tasks || [],
                usage_logs: usageLogs,
                gift_cards: giftCards || [],
            },
        },
    });
}

async function exportUsage(request: AccountExportRequest): Promise<AccountExportResponse> {
    await requireAdmin(request.auth);

    const usageRepo = Repository.instance<any>("usage_log");

    const usageLogs: any[] = [];
    for await (const batch of usageRepo.findAllIgnoreDeleteBatch(2000)) {
        usageLogs.push(...batch);
    }

    return new AccountExportResponse({
        success: true,
        message: "success",
        data: {
            version: 1,
            exported_at: Date.now(),
            data: {
                usage_logs: usageLogs,
            },
        },
    });
}

async function exportTasks(request: AccountExportRequest): Promise<AccountExportResponse> {
    await requireAdmin(request.auth);

    const taskRepo = Repository.instance<any>("Task");
    const tasks = await taskRepo.findAllIgnoreDelete();

    return new AccountExportResponse({
        success: true,
        message: "success",
        data: {
            version: 1,
            exported_at: Date.now(),
            data: {
                tasks: tasks || [],
            },
        },
    });
}

async function importData(request: AccountImportRequest): Promise<AccountImportResponse> {
    await requireAdmin(request.auth);

    const { data } = request.data;
    const imported: Record<string, number> = {};

    const accountRepo = Repository.instance<any>("Account");
    const modelRepo = Repository.instance<any>("Model");
    const providerRepo = Repository.instance<any>("Provider");
    const roleRepo = Repository.instance<any>("Role");
    const accountRoleRepo = Repository.instance<any>("account_role");
    const recordRepo = Repository.instance<any>("Transaction");
    const taskRepo = Repository.instance<any>("Task");
    const usageRepo = Repository.instance<any>("usage_log");
    const giftCardRepo = Repository.instance<any>("gift_card");

    type TableDef = { repo: Repository<any>; items: any[] | undefined; name: string };
    const tables: TableDef[] = [
        { repo: roleRepo, items: data.roles, name: "roles" },
        { repo: accountRepo, items: data.accounts, name: "accounts" },
        { repo: accountRoleRepo, items: data.account_roles, name: "account_roles" },
        { repo: modelRepo, items: data.models, name: "models" },
        { repo: providerRepo, items: data.providers, name: "providers" },
        { repo: taskRepo, items: data.tasks, name: "tasks" },
        { repo: usageRepo, items: data.usage_logs, name: "usage_logs" },
        { repo: recordRepo, items: data.transactions, name: "transactions" },
        { repo: giftCardRepo, items: data.gift_cards, name: "gift_cards" },
    ];

    async function importTable(repo: Repository<any>, items: any[] | undefined, name: string) {
        if (!items || items.length === 0) return;
        let count = 0;
        // Batch insert in chunks of 1000 to avoid excessive memory and transaction size
        for (let i = 0; i < items.length; i += 1000) {
            const chunk = items.slice(i, i + 1000);
            count += await repo.batchInsert(chunk);
        }
        imported[name] = count;
    }

    // Only hard-delete and import tables with non-empty arrays
    for (const { repo, items, name } of tables) {
        if (!items || items.length === 0) {
            continue;
        }
        await repo.hardDelete({});
        await importTable(repo, items, name);
    }

    // Recalculate balances for imported accounts
    if (data.accounts && data.accounts.length > 0) {
        await AccountService.initBalances();
    }

    return new AccountImportResponse({
        success: true,
        message: "import completed",
        data: { imported },
    });
}

export const accountController = new AccountRouterInstance(inject, { list, detail, create, update, delete: del, profile, regenerate, export: exportData, export_usage: exportUsage, export_tasks: exportTasks, import: importData });
