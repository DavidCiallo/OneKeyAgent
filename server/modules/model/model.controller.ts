import {
    ModelDTO,
    ModelListRequest,
    ModelDetailRequest,
    ModelCreateRequest,
    ModelUpdateRequest,
    ModelDeleteRequest,
} from "../../../shared/modules/model/model.interface";
import { modelRoutes } from "../../../shared/modules/model/model.router";
import { getIdentifyByVerify, requireAdmin } from "../auth/auth.service";
import { ModelService } from "./model.service";

async function list(request: ModelListRequest) {
    request = ModelListRequest.self(request);
    const { page, auth, filter } = request;
    if (!auth || !getIdentifyByVerify(auth)) throw "Authorization failed";

    const search: Partial<Record<string, any>> = {};
    if (filter?.alias) search.alias = filter.alias;

    const { list: data, total } = await ModelService.find(page, search as any);
    const list = data.map(item => new ModelDTO(item));

    return { list, total };
}

async function detail(request: ModelDetailRequest) {
    request = ModelDetailRequest.self(request);
    await requireAdmin(request?.auth);
    const { id } = request;
    const data = await ModelService.findOne(id);
    if (!data) throw "model not found";
    const model = new ModelDTO(data);
    return { model };
}

async function create(request: ModelCreateRequest) {
    request = ModelCreateRequest.self(request);
    await requireAdmin(request?.auth);
    const data = await ModelService.create(request.model);
    const model = new ModelDTO(data);
    return { model };
}

async function update(request: ModelUpdateRequest) {
    request = ModelUpdateRequest.self(request);
    await requireAdmin(request?.auth);
    if (!request.id || !request.model) throw "miss params";
    const data = await ModelService.update(request.id, request.model as any);
    if (!data) throw "update failed";
    const model = new ModelDTO(data);
    return { model };
}

async function del(request: ModelDeleteRequest) {
    request = ModelDeleteRequest.self(request);
    await requireAdmin(request?.auth);
    if (!request.id) throw "Id is required";
    await ModelService.delete(request.id);
    return {};
}

export const modelMount = {
    routes: modelRoutes,
    handlers: { list, detail, create, update, delete: del },
};
