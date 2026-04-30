import {
    ProviderDTO,
    ProviderListRequest, ProviderListResponse,
    ProviderDetailRequest, ProviderDetailResponse,
    ProviderCreateRequest, ProviderCreateResponse,
    ProviderUpdateRequest, ProviderUpdateResponse,
    ProviderDeleteRequest, ProviderDeleteResponse,
} from "../../../shared/modules/provider/provider.interface";
import { ProviderRouterInstance } from "../../../shared/modules/provider/provider.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, getAccountByEmail } from "../auth/auth.service";
import { ProviderService } from "./provider.service";

async function requireAdmin(auth?: string): Promise<void> {
    if (!auth) throw "Authorization failed";
    const email = getIdentifyByVerify(auth);
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account || !account.is_admin) throw "Permission denied";
}

async function list(request: ProviderListRequest): Promise<ProviderListResponse> {
    request = ProviderListRequest.self(request);
    await requireAdmin(request.auth);

    const search: Partial<Record<string, any>> = {};
    if (request.filter?.modelAlias) search.modelAlias = request.filter.modelAlias;
    if (request.filter?.enabled !== undefined) search.enabled = request.filter.enabled;

    const { list: data, total } = await ProviderService.find(request.page, search as any);
    const list = data.map(item => new ProviderDTO(item));

    return new ProviderListResponse({
        success: true,
        message: "success",
        data: { list, total },
    });
}

async function detail(request: ProviderDetailRequest): Promise<ProviderDetailResponse> {
    request = ProviderDetailRequest.self(request);
    await requireAdmin(request.auth);

    const data = await ProviderService.findOne(request.id);
    if (!data) throw "provider not found";
    const provider = new ProviderDTO(data);
    return new ProviderDetailResponse({
        success: true,
        data: { provider },
        message: "success",
    });
}

async function create(request: ProviderCreateRequest): Promise<ProviderCreateResponse> {
    request = ProviderCreateRequest.self(request);
    await requireAdmin(request.auth);

    const data = await ProviderService.create(request.provider);
    if (!data) throw "create failed";
    const provider = new ProviderDTO(data);
    return new ProviderCreateResponse({
        success: true,
        data: { provider },
        message: "success",
    });
}

async function update(request: ProviderUpdateRequest): Promise<ProviderUpdateResponse> {
    request = ProviderUpdateRequest.self(request);
    await requireAdmin(request.auth);

    const data = await ProviderService.update(request.id, request.provider);
    if (!data) throw "update failed";
    const provider = new ProviderDTO(data);
    return new ProviderUpdateResponse({
        success: true,
        data: { provider },
        message: "success",
    });
}

async function del(request: ProviderDeleteRequest): Promise<ProviderDeleteResponse> {
    request = ProviderDeleteRequest.self(request);
    await requireAdmin(request.auth);
    if (!request.id) throw "Delete wrong";
    await ProviderService.delete(request.id);
    return new ProviderDeleteResponse({
        success: true,
        message: "success",
    });
}

export const providerController = new ProviderRouterInstance(inject, { list, detail, create, update, delete: del });
