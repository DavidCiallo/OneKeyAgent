import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";
import {
    UsageListRequest,
    UsageListResponse,
    UsageDTO,
    UsageStatsRequest,
    UsageStatsResponse,
} from "../../../shared/modules/usage/usage.interface";
import { UsageRouterInstance } from "../../../shared/modules/usage/usage.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify } from "../auth/auth.service";
import { UsageService } from "./usage.service";

async function list(request: UsageListRequest): Promise<UsageListResponse> {
    request = UsageListRequest.self(request);
    const { page, auth, filter } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }

    const search: Partial<UsageLogEntity> = {};
    if (filter?.apiKey) search.apiKey = filter.apiKey;
    if (filter?.modelId) search.modelId = filter.modelId;

    const { list: data, total } = await UsageService.find(page, search);
    const list = data.map(item => new UsageDTO(item));

    return new UsageListResponse({
        success: true,
        message: "success",
        data: { list, total },
    });
}

async function stats(request: UsageStatsRequest): Promise<UsageStatsResponse> {
    request = UsageStatsRequest.self(request);
    const { auth, modelId } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }
    const data = await UsageService.stats(modelId);
    return new UsageStatsResponse({
        success: true,
        message: "success",
        data,
    });
}

export const usageController = new UsageRouterInstance(inject, { list, stats });
