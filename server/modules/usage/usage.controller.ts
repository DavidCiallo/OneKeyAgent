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
} from "../../../shared/modules/usage/usage.interface";
import { UsageRouterInstance } from "../../../shared/modules/usage/usage.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify } from "../auth/auth.service";
import { AccountService } from "../account/account.service";
import { UsageService } from "./usage.service";

async function list(request: UsageListRequest): Promise<UsageListResponse> {
    request = UsageListRequest.self(request);
    const { page, auth, filter } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }

    const search: Partial<UsageLogEntity> = {};
    if (filter?.accountId) search.accountId = filter.accountId;
    if (filter?.modelAlias) search.modelAlias = filter.modelAlias;

    const since = Date.now() - 30 * 86400000;
    const { list: data, total } = await UsageService.find(page, search, since);

    // Resolve accountId to account name (email)
    const accountIds = [...new Set(data.map(item => item.accountId))];
    const accounts = await Promise.all(
        accountIds.map(id => AccountService.findOne(id).then(a => ({ id, name: a ? `${a.name} (${a.email})` : id })))
    );
    const accountMap = new Map(accounts.map(a => [a.id, a.name]));

    // Resolve providerId to provider name (include soft-deleted ones for history display)
    const providerIds = [...new Set(data.map(item => item.providerId).filter(Boolean))] as string[];
    const providerService = await import("../provider/provider.service").then(m => m.ProviderService);
    const providers = await Promise.all(
        providerIds.map(id => providerService.findOneIgnoreDelete(id).then(p => ({ id, name: p?.name || id })))
    );
    const providerMap = new Map(providers.map(p => [p.id, p.name]));

    const list = data.map(item => {
        const cost = (item.inputTokens * (item.inputPrice || 0) + item.outputTokens * (item.outputPrice || 0)) / 1_000_000;
        return new UsageDTO({
            ...item,
            accountName: accountMap.get(item.accountId) || item.accountId,
            providerName: item.providerId ? providerMap.get(item.providerId) || item.providerId : undefined,
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
    const { auth, modelAlias } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }
    const data = await UsageService.stats(modelAlias);
    return new UsageStatsResponse({
        success: true,
        message: "success",
        data,
    });
}

async function sessions(request: UsageSessionsRequest): Promise<UsageSessionsResponse> {
    request = UsageSessionsRequest.self(request);
    const { auth } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }

    const groups = await UsageService.getUserSessions(request.gapMinutes, request.since, request.accountId);

    // Resolve account names
    const accountIds = [...new Set(groups.map(g => g.accountId))];
    const accounts = await Promise.all(
        accountIds.map(id => AccountService.findOne(id).then(a => ({ id, name: a ? `${a.name} (${a.email})` : id })))
    );
    const accountMap = new Map(accounts.map(a => [a.id, a.name]));

    const allProviderIds = [...new Set(groups.flatMap(g => g.sessions.flatMap(s => s.providerUsage.map(p => p.providerName))))];
    const providerService = await import("../provider/provider.service").then(m => m.ProviderService);
    const providers = await Promise.all(
        allProviderIds.map(id => providerService.findOneIgnoreDelete(id).then(p => ({ id, name: p?.name || id })))
    );
    const providerMap = new Map(providers.map(p => [p.id, p.name]));

    const data: UserSessionGroup[] = groups.map(g => ({
        ...g,
        accountName: accountMap.get(g.accountId) || g.accountId,
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
    });
}

export const usageController = new UsageRouterInstance(inject, { list, stats, sessions });
