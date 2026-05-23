import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";
import {
    UsageListRequest,
    UsageListResponse,
    UsageDTO,
    UsageStatsRequest,
    UsageStatsResponse,
    UsageSessionsRequest,
    UsageSessionsResponse,
    UserSessionGroup,
    UserSession,
} from "../../../shared/modules/usage/usage.interface";
import { UsageRouterInstance } from "../../../shared/modules/usage/usage.router";
import { inject } from "../../lib/inject";
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

async function list(request: UsageListRequest): Promise<UsageListResponse> {
    request = UsageListRequest.self(request);
    const { page, auth, filter } = request;
    if (!auth) throw "Authorization failed";

    const account = await resolveAccount(auth);

    const search: Partial<UsageLogEntity> = {};
    if (account.is_admin) {
        if (filter?.account_id) search.account_id = filter.account_id;
    } else {
        search.account_id = account.id;
    }
    if (filter?.model_alias) search.model_alias = filter.model_alias;

    const since = Date.now() - 30 * 86400000;
    const { list: data, total } = await UsageService.find(page, search, since);

    // Resolve account_id to account name (email)
    const account_ids = [...new Set(data.map(item => item.account_id))];
    const accounts = await Promise.all(
        account_ids.map(id => AccountService.findOne(id).then(a => ({ id, name: a ? `${a.name} (${a.email})` : id })))
    );
    const accountMap = new Map(accounts.map(a => [a.id, a.name]));

    // Resolve provider_id to provider name (include soft-deleted ones for history display)
    const provider_ids = [...new Set(data.map(item => item.provider_id).filter(Boolean))] as string[];
    const providerService = await import("../provider/provider.service").then(m => m.ProviderService);
    const providers = await Promise.all(
        provider_ids.map(id => providerService.findOneIgnoreDelete(id).then(p => ({ id, name: p?.name || id })))
    );
    const providerMap = new Map(providers.map(p => [p.id, p.name]));

    const list = data.map(item => {
        const cost = (item.input_tokens * (item.input_price || 0) + item.output_tokens * (item.output_price || 0)) / 1_000_000;
        return new UsageDTO({
            ...item,
            accountName: accountMap.get(item.account_id) || item.account_id,
            providerName: item.provider_id ? providerMap.get(item.provider_id) || item.provider_id : undefined,
            cost: Math.round(cost * 1_000_000) / 1_000_000,
        });
    });

    return new UsageListResponse({
        success: true,
        message: "success",
        data: { list, total },
    });
}

async function stats(request: UsageStatsRequest): Promise<UsageStatsResponse> {
    request = UsageStatsRequest.self(request);
    const { auth, model_alias } = request;
    if (!auth) throw "Authorization failed";
    const account = await resolveAccount(auth);
    const data = await UsageService.stats(model_alias, account.is_admin ? undefined : account.id);
    return new UsageStatsResponse({
        success: true,
        message: "success",
        data,
    });
}

async function sessions(request: UsageSessionsRequest): Promise<UsageSessionsResponse> {
    request = UsageSessionsRequest.self(request);
    const { auth } = request;
    if (!auth) throw "Authorization failed";
    const account = await resolveAccount(auth);
    const effectiveAccountIds = account.is_admin ? request.account_ids : [account.id];

    const { groups, totals } = await UsageService.getUserSessions(request.gapMinutes, request.since, effectiveAccountIds, account.is_admin ? true : false);

    // Fetch 1min-granularity sessions for the recent list
    const { groups: rawGroups } = await UsageService.getUserSessions(1, request.since, effectiveAccountIds, account.is_admin ? true : false);

    // Resolve account names
    const allGroupIds = [...new Set([...groups, ...rawGroups].map(g => g.account_id))];
    const accounts = await Promise.all(
        allGroupIds.map(id => AccountService.findOne(id).then(a => ({ id, name: a ? `${a.name} (${a.email})` : id })))
    );
    const accountMap = new Map(accounts.map(a => [a.id, a.name]));

    const allRawSessions: (UserSession & { account_id: string })[] = [];
    for (const g of rawGroups) {
        for (const s of g.sessions) {
            allRawSessions.push({ ...s, account_id: g.account_id });
        }
    }
    allRawSessions.sort((a, b) => b.startTime - a.startTime);
    const recentSessions = allRawSessions.slice(0, 10).map(s => ({
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
        // Non-admin: providerName is actually model_alias, use as-is
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

    return new UsageSessionsResponse({
        success: true,
        message: "success",
        data,
        totals,
        recentSessions,
    });
}

export const usageController = new UsageRouterInstance(inject, { list, stats, sessions });
