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
    const buckets = await bucketRepo.find({ account_id: account.id }, { since });
    const weeklyUsage = buckets.reduce((sum: number, b: any) => sum + (b.cost || 0), 0);

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
    const usageRepo = Repository.instance<any>("usage_log");
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

    const [transactions, usageLogs, usageBuckets] = await Promise.all([
        (async () => { const r: any[] = []; for await (const b of recordRepo.findAllIgnoreDeleteBatch(2000)) r.push(...b); return r; })(),
        (async () => { const r: any[] = []; for await (const b of usageRepo.findAllIgnoreDeleteBatch(2000)) r.push(...b); return r; })(),
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
            usage_logs: usageLogs,
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
    const usageRepo = Repository.instance<any>("usage_log");
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
        { repo: usageRepo, items: data.usage_logs, name: "usage_logs" },
        { repo: bucketRepo, items: data.usage_buckets, name: "usage_buckets" },
        { repo: recordRepo, items: data.transactions, name: "transactions" },
        { repo: giftCardRepo, items: data.gift_cards, name: "gift_cards" },
    ];

    async function importTable(repo: Repository<any>, items: any[] | undefined, name: string) {
        if (!items || items.length === 0) return;
        let count = 0;
        for (let i = 0; i < items.length; i += 1000) {
            const chunk = items.slice(i, i + 1000);
            count += await repo.batchInsert(chunk);
        }
        imported[name] = count;
    }

    for (const { repo, items, name } of tables) {
        if (!items || items.length === 0) continue;
        await repo.truncate();
        await importTable(repo, items, name);
    }

    // Rebuild usage_buckets from usage_logs if importing an old backup without bucket data
    const usageLogs = data.usage_logs;
    const usageBuckets = data.usage_buckets;
    if (usageLogs && usageLogs.length > 0 && (!usageBuckets || usageBuckets.length === 0)) {
        await bucketRepo.truncate();
        const rebuilt = rebuildBuckets(usageLogs);
        await bucketRepo.batchInsert(rebuilt);
        imported["usage_buckets"] = rebuilt.length;
    }

    if (data.accounts && data.accounts.length > 0) {
        await AccountService.initBalances();
    }

    return { imported };
}

function rebuildBuckets(logs: any[]): any[] {
    const GRANULARITY_MS: Record<string, number> = {
        "1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000, "60m": 3600000,
    };
    const TTL_MS: Record<string, number> = {
        "1m": 86400000, "5m": 86400000, "15m": 604800000, "30m": 604800000, "60m": 7776000000,
    };

    // Build 1min buckets from raw logs
    const acc1m = new Map<string, any>();
    for (const log of logs) {
        const cost = Math.round(((log.input_tokens || 0) * (log.input_price || 0) + (log.output_tokens || 0) * (log.output_price || 0)) / 1_000_000 * 1_000_000) / 1_000_000;
        const bt = Math.floor(log.create_time / 60000) * 60000;
        const key = `${bt}|${log.account_id}|${log.model_alias}|${log.provider_id || "unknown"}`;
        let entry = acc1m.get(key);
        if (!entry) {
            entry = { account_id: log.account_id, model_alias: log.model_alias, provider_id: log.provider_id || "unknown", bucket_time: bt, granularity: "1m", input_tokens: 0, output_tokens: 0, cost: 0, request_count: 0 };
            acc1m.set(key, entry);
        }
        entry.input_tokens += log.input_tokens || 0;
        entry.output_tokens += log.output_tokens || 0;
        entry.cost += cost;
        entry.request_count += 1;
    }

    const records: any[] = [];
    const allEntries = [...acc1m.values()];

    // Write 1m records
    for (const e of allEntries) {
        records.push({ ...e, clean_timestamp: e.bucket_time + TTL_MS["1m"] });
    }

    // Promote to coarser granularities: 1m→5m→15m→30m→60m
    for (let i = 1; i < ["1m", "5m", "15m", "30m", "60m"].length; i++) {
        const granularity = ["1m", "5m", "15m", "30m", "60m"][i];
        const prevGran = ["1m", "5m", "15m", "30m", "60m"][i - 1];
        const interval = GRANULARITY_MS[granularity];
        const acc = new Map<string, any>();
        const sourceEntries = records.filter(r => r.granularity === prevGran);
        for (const e of sourceEntries) {
            const bt = Math.floor(e.bucket_time / interval) * interval;
            const key = `${bt}|${e.account_id}|${e.model_alias}|${e.provider_id}`;
            let entry = acc.get(key);
            if (!entry) {
                entry = { account_id: e.account_id, model_alias: e.model_alias, provider_id: e.provider_id, bucket_time: bt, granularity, input_tokens: 0, output_tokens: 0, cost: 0, request_count: 0 };
                acc.set(key, entry);
            }
            entry.input_tokens += e.input_tokens;
            entry.output_tokens += e.output_tokens;
            entry.cost += e.cost;
            entry.request_count += e.request_count;
        }
        for (const e of acc.values()) {
            records.push({ ...e, clean_timestamp: e.bucket_time + TTL_MS[granularity] });
        }
    }

    return records;
}

export const accountMount = {
    routes: accountRoutes,
    handlers: { list, detail, create, update, delete: del, profile, regenerate, export: exportData, import: importData },
};
