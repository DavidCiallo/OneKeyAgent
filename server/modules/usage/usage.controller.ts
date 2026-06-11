import {
    UsageListRequest,
    UsageDTO,
    UsageStatsRequest,
    UsageSessionsRequest,
    UsageStatsBatchRequest,
    UserSessionGroup,
    UserSession,
} from "../../../shared/modules/usage/usage.interface";
import { usageRoutes } from "../../../shared/modules/usage/usage.router";
import { getIdentifyByVerify, getAccountByEmail } from "../auth/auth.service";
import { AccountService } from "../account/account.service";
import { UsageService } from "./usage.service";

async function resolveAccount(auth: string): Promise<{ id: string; is_admin: number }> {
    const email = getIdentifyByVerify(auth);
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account) throw "Account not found";
    return { id: account.id, is_admin: account.is_admin };
}

async function list(request: UsageListRequest) {
    request = UsageListRequest.self(request);
    const { page, auth, filter } = request;
    if (!auth) throw "Authorization failed";

    const account = await resolveAccount(auth);

    const search: { account_id?: string; model_alias?: string } = {};
    if (account.is_admin) {
        if (filter?.account_id) search.account_id = filter.account_id;
    } else {
        search.account_id = account.id;
    }
    if (filter?.model_alias) search.model_alias = filter.model_alias;

    const since = Date.now() - 30 * 86400000;
    const { list: data, total } = await UsageService.find(page, search, since);

    const account_ids = [...new Set(data.map(item => item.account_id))];
    const accounts = await Promise.all(
        account_ids.map(id => AccountService.findOne(id).then(a => ({ id, name: a ? `${a.name} (${a.email})` : id })))
    );
    const accountMap = new Map(accounts.map(a => [a.id, a.name]));

    const provider_ids = [...new Set(data.map(item => item.provider_id).filter(Boolean))] as string[];
    const providerService = await import("../provider/provider.service").then(m => m.ProviderService);
    const providers = await Promise.all(
        provider_ids.map(id => providerService.findOneIgnoreDelete(id).then(p => ({ id, name: p?.name || id })))
    );
    const providerMap = new Map(providers.map(p => [p.id, p.name]));

    const list = data.map(item => {
        return new UsageDTO({
            ...item,
            accountName: accountMap.get(item.account_id) || item.account_id,
            providerName: item.provider_id ? providerMap.get(item.provider_id) || item.provider_id : undefined,
            cost: Math.round((item.cost || 0) * 1_000_000) / 1_000_000,
        });
    });

    return { list, total };
}

async function stats(request: UsageStatsRequest) {
    request = UsageStatsRequest.self(request);
    const { auth, model_alias } = request;
    if (!auth) throw "Authorization failed";
    const account = await resolveAccount(auth);
    const data = await UsageService.stats(model_alias, account.is_admin ? undefined : account.id);
    return data;
}

async function statsBatch(request: UsageStatsBatchRequest) {
    request = UsageStatsBatchRequest.self(request);
    const { auth, model_aliases } = request;
    if (!auth) throw "Authorization failed";
    const account = await resolveAccount(auth);
    const results = await UsageService.statsBatch(model_aliases, account.is_admin ? undefined : account.id);
    const data: Record<string, any> = {};
    for (const [alias, result] of results) {
        data[alias] = result;
    }
    return data;
}

async function sessions(request: UsageSessionsRequest) {
    request = UsageSessionsRequest.self(request);
    const { auth } = request;
    if (!auth) throw "Authorization failed";
    const account = await resolveAccount(auth);
    const effectiveAccountIds = account.is_admin ? request.account_ids : [account.id];

    const { groups, totals, recentSessions: rawSessions } = await UsageService.getUserSessions(request.gapMinutes, request.since, effectiveAccountIds, account.is_admin ? true : false, request.model_aliases, request.provider_ids);

    const allGroupIds = [...new Set([...groups.map(g => g.account_id), ...rawSessions.map(s => s.account_id)])];
    const accounts = await Promise.all(
        allGroupIds.map(id => AccountService.findOne(id).then(a => ({ id, name: a ? `${a.name} (${a.email})` : id })))
    );
    const accountMap = new Map(accounts.map(a => [a.id, a.name]));

    const recentSessions = rawSessions.map(s => ({
        ...s,
        accountName: accountMap.get(s.account_id) || s.account_id,
    }));

    const allProviderIds = [...new Set(groups.flatMap(g => g.sessions.flatMap(s => s.providerUsage.map(p => p.providerName))))];
    let providerMap = new Map<string, string>();
    if (account.is_admin) {
        const providerService = await import("../provider/provider.service").then(m => m.ProviderService);
        const providers = await Promise.all(
            allProviderIds.map(id => providerService.findOneIgnoreDelete(id).then(p => ({ id, name: p?.name || id })))
        );
        providerMap = new Map(providers.map(p => [p.id, p.name]));
    } else {
        providerMap = new Map(allProviderIds.map(id => [id, id]));
    }

    const data: UserSessionGroup[] = groups.map(g => ({
        ...g,
        accountName: accountMap.get(g.account_id) || g.account_id,
        sessions: g.sessions.map(s => ({
            ...s,
            providerUsage: s.providerUsage.map(pu => ({
                ...pu,
                providerName: providerMap.get(pu.providerName) || pu.providerName,
            })),
        })),
    }));

    return { list: data, totals, recentSessions };
}

export const usageMount = {
    routes: usageRoutes,
    handlers: { list, stats, statsBatch, sessions },
};
