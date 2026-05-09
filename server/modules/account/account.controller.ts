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
import { getIdentifyByVerify, getAccountByEmail, registerUser } from "../auth/auth.service";
import { AccountService } from "./account.service";
import { generateApiKey } from "../ai/ai.auth";
import Repository from "../../lib/repository";

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

// ========== Export / Import ==========

async function exportData(request: AccountExportRequest): Promise<AccountExportResponse> {
    await requireAdmin(request.auth);

    const accountRepo = Repository.instance<any>("Account");
    const modelRepo = Repository.instance<any>("Model");
    const providerRepo = Repository.instance<any>("Provider");
    const roleRepo = Repository.instance<any>("Role");
    const accountRoleRepo = Repository.instance<any>("AccountRole");
    const planRepo = Repository.instance<any>("SubscriptionPlan");
    const recordRepo = Repository.instance<any>("SubscriptionRecord");
    const taskRepo = Repository.instance<any>("Task");
    const usageRepo = Repository.instance<any>("UsageLog");
    const giftCardRepo = Repository.instance<any>("GiftCard");

    const [accounts, models, providers, roles, accountRoles, plans, records, tasks, usageLogs, giftCards] = await Promise.all([
        accountRepo.findAllIgnoreDelete(),
        modelRepo.findAllIgnoreDelete(),
        providerRepo.findAllIgnoreDelete(),
        roleRepo.findAllIgnoreDelete(),
        accountRoleRepo.findAllIgnoreDelete(),
        planRepo.findAllIgnoreDelete(),
        recordRepo.findAllIgnoreDelete(),
        taskRepo.findAllIgnoreDelete(),
        usageRepo.findAllIgnoreDelete(),
        giftCardRepo.findAllIgnoreDelete(),
    ]);

    return new AccountExportResponse({
        success: true,
        message: "success",
        data: {
            version: 1,
            exported_at: Date.now(),
            data: {
                accounts: (accounts as any[] || []),
                models: models as any[] || [],
                providers: providers as any[] || [],
                roles: roles as any[] || [],
                account_roles: accountRoles as any[] || [],
                subscription_plans: plans as any[] || [],
                subscription_records: records as any[] || [],
                tasks: tasks as any[] || [],
                usage_logs: usageLogs as any[] || [],
                gift_cards: giftCards as any[] || [],
            },
        },
    });
}

async function exportUsage(request: AccountExportRequest): Promise<AccountExportResponse> {
    await requireAdmin(request.auth);

    const usageRepo = Repository.instance<any>("UsageLog");
    const logs = await usageRepo.findAllIgnoreDelete();

    return new AccountExportResponse({
        success: true,
        message: "success",
        data: {
            version: 1,
            exported_at: Date.now(),
            data: {
                usage_logs: (logs as any[] || []),
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
                tasks: (tasks as any[] || []),
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
    const accountRoleRepo = Repository.instance<any>("AccountRole");
    const planRepo = Repository.instance<any>("SubscriptionPlan");
    const recordRepo = Repository.instance<any>("SubscriptionRecord");
    const taskRepo = Repository.instance<any>("Task");
    const usageRepo = Repository.instance<any>("UsageLog");
    const giftCardRepo = Repository.instance<any>("GiftCard");

    type TableDef = { repo: Repository<any>; items: any[] | undefined; name: string };
    const tables: TableDef[] = [
        { repo: roleRepo, items: data.roles, name: "roles" },
        { repo: planRepo, items: data.subscription_plans, name: "subscription_plans" },
        { repo: accountRepo, items: data.accounts, name: "accounts" },
        { repo: accountRoleRepo, items: data.account_roles, name: "account_roles" },
        { repo: modelRepo, items: data.models, name: "models" },
        { repo: providerRepo, items: data.providers, name: "providers" },
        { repo: taskRepo, items: data.tasks, name: "tasks" },
        { repo: usageRepo, items: data.usage_logs, name: "usage_logs" },
        { repo: recordRepo, items: data.subscription_records, name: "subscription_records" },
        { repo: giftCardRepo, items: data.gift_cards, name: "gift_cards" },
    ];

    async function importTable(repo: Repository<any>, items: any[] | undefined, name: string) {
        if (!items || items.length === 0) return;
        let count = 0;
        for (const item of items) {
            await repo.insert(item);
            count++;
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

    return new AccountImportResponse({
        success: true,
        message: "import completed",
        data: { imported },
    });
}

export const accountController = new AccountRouterInstance(inject, { list, detail, create, update, delete: del, profile, regenerate, export: exportData, export_usage: exportUsage, export_tasks: exportTasks, import: importData });
