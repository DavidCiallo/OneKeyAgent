import {
    ModelDTO,
    ModelListRequest,
    ModelListResponse,
    ModelDetailRequest,
    ModelDetailResponse,
    ModelCreateRequest,
    ModelCreateResponse,
    ModelUpdateRequest,
    ModelUpdateResponse,
    ModelDeleteRequest,
    ModelDeleteResponse,
} from "../../../shared/modules/model/model.interface";
import { ModelRouterInstance } from "../../../shared/modules/model/model.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, requireAdmin } from "../auth/auth.service";
import { ModelService } from "./model.service";

async function list(request: ModelListRequest): Promise<ModelListResponse> {
    request = ModelListRequest.self(request);
    const { page, auth, filter } = request;
    if (!auth || !getIdentifyByVerify(auth)) {
        throw "Authorization failed";
    }

    const search: Partial<Record<string, any>> = {};
    if (filter?.alias) search.alias = filter.alias;

    const { list: data, total } = await ModelService.find(page, search as any);
    const list = data.map(item => new ModelDTO(item));

    return new ModelListResponse({
        success: true,
        message: "success",
        data: { list, total },
    });
}

async function detail(request: ModelDetailRequest): Promise<ModelDetailResponse> {
    request = ModelDetailRequest.self(request);
    await requireAdmin(request?.auth);
    const { id } = request;
    const data = await ModelService.findOne(id);
    if (!data) {
        throw "model not found";
    }
    const model = new ModelDTO(data);
    return new ModelDetailResponse({
        success: true,
        message: "success",
        data: { model },
    });
}

async function create(request: ModelCreateRequest): Promise<ModelCreateResponse> {
    request = ModelCreateRequest.self(request);
    await requireAdmin(request?.auth);
    const data = await ModelService.create(request.model);
    const model = new ModelDTO(data);
    return new ModelCreateResponse({
        success: true,
        message: "success",
        data: { model },
    });
}

async function update(request: ModelUpdateRequest): Promise<ModelUpdateResponse> {
    request = ModelUpdateRequest.self(request);
    await requireAdmin(request?.auth);
    if (!request.id || !request.model) {
        throw "miss params";
    }
    const data = await ModelService.update(request.id, request.model as any);
    if (!data) {
        throw "update failed";
    }
    const model = new ModelDTO(data);
    return new ModelUpdateResponse({
        success: true,
        message: "success",
        data: { model },
    });
}

async function del(request: ModelDeleteRequest): Promise<ModelDeleteResponse> {
    request = ModelDeleteRequest.self(request);
    await requireAdmin(request?.auth);

    if (!request.id) {
        throw "Id is required";
    }
    await ModelService.delete(request.id);
    return new ModelDeleteResponse({
        success: true,
        message: "success",
    });
}

export const modelController = new ModelRouterInstance(inject, { list, detail, create, update, delete: del });
