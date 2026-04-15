import { RoleEntity } from "../../../shared/modules/role/role.entity";
import {
    RoleDTO,
    RoleListRequest, RoleListResponse,
    RoleDetailRequest, RoleDetailResponse,
    RoleCreateRequest, RoleCreateResponse,
    RoleUpdateRequest, RoleUpdateResponse,
    RoleDeleteRequest, RoleDeleteResponse,
    AssignRolesRequest, AssignRolesResponse,
    AccountRolesRequest, AccountRolesResponse,
} from "../../../shared/modules/role/role.interface";
import { RoleRouterInstance } from "../../../shared/modules/role/role.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, getAccountByEmail } from "../auth/auth.service";
import { RoleService, AccountRoleService } from "./role.service";

async function requireAdmin(auth?: string): Promise<void> {
    if (!auth) throw "Authorization failed";
    const email = getIdentifyByVerify(auth);
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account || !account.is_admin) throw "Permission denied";
}

async function list(request: RoleListRequest): Promise<RoleListResponse> {
    request = RoleListRequest.self(request);
    await requireAdmin(request.auth);

    const { list: data, total } = await RoleService.find(request.page, {});
    const list = data.map(item => new RoleDTO(item));

    return new RoleListResponse({
        success: true,
        data: { list, total },
        message: "success"
    });
}

async function detail(request: RoleDetailRequest): Promise<RoleDetailResponse> {
    request = RoleDetailRequest.self(request);
    await requireAdmin(request.auth);

    const data = await RoleService.findOne(request.id);
    if (!data) throw "role not found";
    const role = new RoleDTO(data);
    return new RoleDetailResponse({
        success: true,
        data: { role },
        message: "success"
    });
}

async function create(request: RoleCreateRequest): Promise<RoleCreateResponse> {
    request = RoleCreateRequest.self(request);
    await requireAdmin(request.auth);

    const data = await RoleService.create(request.role);
    if (!data) throw "create failed";
    const role = new RoleDTO(data);
    return new RoleCreateResponse({
        success: true,
        data: { role },
        message: "success"
    });
}

async function update(request: RoleUpdateRequest): Promise<RoleUpdateResponse> {
    request = RoleUpdateRequest.self(request);
    await requireAdmin(request.auth);

    const data = await RoleService.update(request.id, request.role);
    if (!data) throw "update failed";
    const role = new RoleDTO(data);
    return new RoleUpdateResponse({
        success: true,
        data: { role },
        message: "success"
    });
}

async function del(request: RoleDeleteRequest): Promise<RoleDeleteResponse> {
    request = RoleDeleteRequest.self(request);
    await requireAdmin(request.auth);
    if (!request.id) throw "Delete wrong";
    await RoleService.delete(request.id);
    return new RoleDeleteResponse({
        success: true,
        message: "success"
    });
}

async function assign(request: AssignRolesRequest): Promise<AssignRolesResponse> {
    request = AssignRolesRequest.self(request);
    await requireAdmin(request.auth);

    await AccountRoleService.assignPermissions(request.account_id, request.roles.permissions);
    return new AssignRolesResponse({
        success: true,
        message: "success"
    });
}

async function accountRoles(request: AccountRolesRequest): Promise<AccountRolesResponse> {
    request = AccountRolesRequest.self(request);
    await requireAdmin(request.auth);

    const roles = await AccountRoleService.findByAccount(request.account_id);
    return new AccountRolesResponse({
        success: true,
        data: { roles: roles.map(r => new RoleDTO(r)) },
        message: "success"
    });
}

export const roleController = new RoleRouterInstance(inject, { list, detail, create, update, delete: del, assign, account_roles: accountRoles });