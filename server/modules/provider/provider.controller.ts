import {
    ProviderDTO,
    ProviderListRequest,
    ProviderDetailRequest,
    ProviderCreateRequest,
    ProviderUpdateRequest,
    ProviderDeleteRequest,
    ProviderUpdatePriorityRequest,
} from "../../../shared/modules/provider/provider.interface";
import { providerRoutes } from "../../../shared/modules/provider/provider.router";
import { requireAdmin } from "../auth/auth.service";
import { ProviderService } from "./provider.service";

async function list(request: ProviderListRequest) {
    request = ProviderListRequest.self(request);
    await requireAdmin(request?.auth);

    const search: Partial<Record<string, any>> = {};
    if (request.filter?.model_alias) search.model_alias = request.filter.model_alias;
    if (request.filter?.enabled !== undefined) search.enabled = request.filter.enabled;

    const { list: data, total } = await ProviderService.find(request.page, search );
    const list = data.map(item => new ProviderDTO(item));

    return { list, total };
}

async function detail(request: ProviderDetailRequest) {
    request = ProviderDetailRequest.self(request);
    await requireAdmin(request.auth);

    const data = await ProviderService.findOne(request.id);
    if (!data) throw "provider not found";
    const provider = new ProviderDTO(data);
    return { provider };
}

async function create(request: ProviderCreateRequest) {
    request = ProviderCreateRequest.self(request);
    await requireAdmin(request.auth);

    const data = await ProviderService.create(request.provider);
    if (!data) throw "create failed";
    const provider = new ProviderDTO(data);
    return { provider };
}

async function update(request: ProviderUpdateRequest) {
    request = ProviderUpdateRequest.self(request);
    await requireAdmin(request.auth);

    const data = await ProviderService.update(request.id, request.provider);
    if (!data) throw "update failed";
    const provider = new ProviderDTO(data);
    return { provider };
}

async function del(request: ProviderDeleteRequest) {
    request = ProviderDeleteRequest.self(request);
    await requireAdmin(request.auth);
    if (!request.id) throw "Delete wrong";
    await ProviderService.delete(request.id);
    return {};
}

async function updatepriority(request: ProviderUpdatePriorityRequest) {
    request = ProviderUpdatePriorityRequest.self(request);
    await requireAdmin(request.auth);

    await ProviderService.updatePriority(request.id, request.delta);
    return {};
}

export const providerMount = {
    routes: providerRoutes,
    handlers: { list, detail, create, update, updatepriority, delete: del },
};
