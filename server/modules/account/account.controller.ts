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
import { accountRoutes } from "../../../shared/modules/account/account.router"
import { getIdentifyByVerify, getAccountByEmail, requireAdmin } from "../auth/auth.service";
import { AccountService } from "./account.service";
import { generateApiKey } from "../ai/ai.auth";
import Repository from "../../lib/repository";
import { hashGenerate } from "../../methods/crypto";

async function list(request: AccountListRequest) {
    request = AccountListRequest.self(request);
    const { page, auth } = request;
    await requireAdmin(auth);

    const search: Partial<AccountEntity> = {}
    if (request.filter?.name) search.name = request.filter.name;
    if (request.filter?.email) search.email = request.filter.email;

    const { list: data, total } = await AccountService.find(page, search);
    const list = data.map(item => new AccountDTO(item));

    return { list, total };
}

async function detail(request: AccountDetailRequest) {
    request = AccountDetailRequest.self(request);
    const { id, auth } = request;
    await requireAdmin(auth);
    const data = await AccountService.findOne(id);
    if (!data) throw "account not found";
    const account = new AccountDTO(data);
    return { account };
}

async function create(request: AccountCreateRequest) {
    request = AccountCreateRequest.self(request);
    if (!request.account) throw "miss params";
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
    return { account: data };
}

async function update(request: AccountUpdateRequest) {
    request = AccountUpdateRequest.self(request);
    await requireAdmin(request.auth);

    if (request.account.email) {
        const existing = await AccountService.findByEmail(request.account.email);
        if (existing && existing.id !== request.id) throw "email already exists";
    }

    const data = await AccountService.update(request.id, request.account);
    if (!data) throw "update failed";
    const account = new AccountDTO(data);
    return { account };
}

async function del(request: AccountDeleteRequest) {
    request = AccountDeleteRequest.self(request);
    await requireAdmin(request.auth);
    if (!request.id) throw "Delete wrong";
    await AccountService.delete(request.id);
    return {};
}

async function profile(request: AccountProfileRequest) {
    request = AccountProfileRequest.self(request);
    const email = getIdentifyByVerify(request.auth || "");
    if (!email) throw new Error("Unauthorized");
    const account = await getAccountByEmail(email);
    if (!account) throw new Error("Account not found");

    const since = Date.now() - 7 * 86400000;
    const bucketRepo = Repository.instance<any>("usage_bucket");
    const weeklyUsage = await bucketRepo.sum("cost", { account_id: account.id, granularity: "1m" }, since);

    return {
        account: new AccountDTO(account),
        weeklyUsage: Math.round(weeklyUsage * 1_000_000) / 1_000_000,
        balance: account.balance,
    };
}

async function regenerate(request: AccountRegenerateRequest) {
    request = AccountRegenerateRequest.self(request);
    const email = getIdentifyByVerify(request.auth || "");
    if (!email) throw new Error("Unauthorized");
    const account = await getAccountByEmail(email);
    if (!account) throw new Error("Account not found");
    const newApiKey = generateApiKey();
    await AccountService.update(account.id, { api_key: newApiKey });
    return { api_key: newApiKey };
}

// ========== Export / Import ==========

async function exportData(request: AccountExportRequest) {
    await requireAdmin(request.auth);

    const accountRepo = Repository.instance<any>("Account");
    const modelRepo = Repository.instance<any>("Model");
    const providerRepo = Repository.instance<any>("Provider");
    const roleRepo = Repository.instance<any>("Role");
    const accountRoleRepo = Repository.instance<any>("account_role");
    const recordRepo = Repository.instance<any>("Transaction");
    const taskRepo = Repository.instance<any>("Task");
    const bucketRepo = Repository.instance<any>("usage_bucket");
    const giftCardRepo = Repository.instance<any>("gift_card");

    const [accounts, models, providers, roles, accountRoles, tasks, giftCards] = await Promise.all([
        accountRepo.findAllIgnoreDelete(),
        modelRepo.findAllIgnoreDelete(),
        providerRepo.findAllIgnoreDelete(),
        roleRepo.findAllIgnoreDelete(),
        accountRoleRepo.findAllIgnoreDelete(),
        taskRepo.findAllIgnoreDelete(),
        giftCardRepo.findAllIgnoreDelete(),
    ]);

    const [transactions, usageBuckets] = await Promise.all([
        (async () => { const r: any[] = []; for await (const b of recordRepo.findAllIgnoreDeleteBatch(2000)) r.push(...b); return r; })(),
        (async () => { const r: any[] = []; for await (const b of bucketRepo.findAllIgnoreDeleteBatch(2000)) r.push(...b); return r; })(),
    ]);

    return {
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
            usage_buckets: usageBuckets,
            gift_cards: giftCards || [],
        },
    };
}

async function importData(request: AccountImportRequest) {
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
    const bucketRepo = Repository.instance<any>("usage_bucket");
    const giftCardRepo = Repository.instance<any>("gift_card");

    type TableDef = { repo: Repository<any>; items: any[] | undefined; name: string };
    const tables: TableDef[] = [
        { repo: roleRepo, items: data.roles, name: "roles" },
        { repo: accountRepo, items: data.accounts, name: "accounts" },
        { repo: accountRoleRepo, items: data.account_roles, name: "account_roles" },
        { repo: modelRepo, items: data.models, name: "models" },
        { repo: providerRepo, items: data.providers, name: "providers" },
        { repo: taskRepo, items: data.tasks, name: "tasks" },
        { repo: bucketRepo, items: data.usage_buckets, name: "usage_buckets" },
        { repo: recordRepo, items: data.transactions, name: "transactions" },
        { repo: giftCardRepo, items: data.gift_cards, name: "gift_cards" },
    ];

    async function importTable(repo: Repository<any>, items: any[] | undefined, name: string) {
        if (!items || items.length === 0) return;
        const alive = items.filter(item => !item.delete_time);
        let count = 0;
        for (let i = 0; i < alive.length; i += 1000) {
            const chunk = alive.slice(i, i + 1000);
            count += await repo.batchInsert(chunk);
        }
        imported[name] = count;
    }

    // Truncate ALL tables first, regardless of whether data exists in the import
    for (const { repo } of tables) {
        await repo.truncate();
    }

    for (const { repo, items, name } of tables) {
        if (!items || items.length === 0) continue;
        await importTable(repo, items, name);
    }

    if (data.accounts && data.accounts.length > 0) {
        // Recalculate balances from transactions and gift cards
        for (const a of data.accounts) {
            const txs = (data.transactions || []).filter((t: any) => t.account_id === a.id && t.status === "confirmed");
            const cards = (data.gift_cards || []).filter((c: any) => c.redeemed_by === a.id && c.status === "redeemed");
            const credit = txs.reduce((s: number, t: any) => s + (t.amount || 0), 0) + cards.reduce((s: number, c: any) => s + (c.token_amount || 0), 0);
            await accountRepo.update({ id: a.id }, { balance: credit });
        }
    }

    return { imported };
}
export const accountMount = {
    routes: accountRoutes,
    handlers: { list, detail, create, update, delete: del, profile, regenerate, export: exportData, import: importData },
};
