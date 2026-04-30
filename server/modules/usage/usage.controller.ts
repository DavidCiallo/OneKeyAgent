import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";
import {
    UsageListRequest,
    UsageListResponse,
    UsageDTO,
    UsageStatsRequest,
    UsageStatsResponse,
    MyUsageRequest,
    MyUsageResponse,
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

    const { list: data, total } = await UsageService.find(page, search);

    // Resolve accountId to account name (email)
    const accountIds = [...new Set(data.map(item => item.accountId))];
    const accounts = await Promise.all(
        accountIds.map(id => AccountService.findOne(id).then(a => ({ id, name: a ? `${a.name} (${a.email})` : id })))
    );
    const accountMap = new Map(accounts.map(a => [a.id, a.name]));

    // Resolve providerId to provider name
    const providerIds = [...new Set(data.map(item => item.providerId).filter(Boolean))] as string[];
    const providerService = await import("../provider/provider.service").then(m => m.ProviderService);
    const providers = await Promise.all(
        providerIds.map(id => providerService.findOne(id).then(p => ({ id, name: p?.name || id })))
    );
    const providerMap = new Map(providers.map(p => [p.id, p.name]));

    const list = data.map(item => new UsageDTO({
        ...item,
        accountName: accountMap.get(item.accountId) || item.accountId,
        providerName: item.providerId ? providerMap.get(item.providerId) || item.providerId : undefined,
    }));

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

async function mystats(request: MyUsageRequest): Promise<MyUsageResponse> {
    request = MyUsageRequest.self(request);
    const { auth } = request;
    if (!auth) throw "Authorization failed";
    const email = getIdentifyByVerify(auth);
    if (!email) throw "Authorization failed";

    const account = await AccountService.findByEmail(email);
    if (!account) throw "Account not found";

    const data = await UsageService.myStats(account.id);

    return new MyUsageResponse({
        success: true,
        message: "success",
        data,
    });
}

export const usageController = new UsageRouterInstance(inject, { list, stats, mystats });
