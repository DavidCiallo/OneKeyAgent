import {
    RoleDTO,
    RoleListRequest,
    RoleDetailRequest,
    RoleCreateRequest,
    RoleUpdateRequest,
    RoleDeleteRequest,
    AssignRolesRequest,
    AccountRolesRequest,
} from "../../../shared/modules/role/role.interface";
import { roleRoutes } from "../../../shared/modules/role/role.router";
import { getIdentifyByVerify, getAccountByEmail } from "../auth/auth.service";
import { RoleService, AccountRoleService } from "./role.service";

async function requireAdmin(auth?: string): Promise<void> {
    if (!auth) throw "Authorization failed";
    const email = getIdentifyByVerify(auth);
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account || !account.is_admin) throw "Permission denied";
}

async function list(request: RoleListRequest) {
    request = RoleListRequest.self(request);
    await requireAdmin(request.auth);

    const { list: data, total } = await RoleService.find(request.page, {});
    const list = data.map(item => new RoleDTO(item));

    return { list, total };
}

async function detail(request: RoleDetailRequest) {
    request = RoleDetailRequest.self(request);
    await requireAdmin(request.auth);

    const data = await RoleService.findOne(request.id);
    if (!data) throw "role not found";
    const role = new RoleDTO(data);
    return { role };
}

async function create(request: RoleCreateRequest) {
    request = RoleCreateRequest.self(request);
    await requireAdmin(request.auth);

    const data = await RoleService.create(request.role);
    if (!data) throw "create failed";
    const role = new RoleDTO(data);
    return { role };
}

async function update(request: RoleUpdateRequest) {
    request = RoleUpdateRequest.self(request);
    await requireAdmin(request.auth);

    const data = await RoleService.update(request.id, request.role);
    if (!data) throw "update failed";
    const role = new RoleDTO(data);
    return { role };
}

async function del(request: RoleDeleteRequest) {
    request = RoleDeleteRequest.self(request);
    await requireAdmin(request.auth);
    if (!request.id) throw "Delete wrong";
    await RoleService.delete(request.id);
    return {};
}

async function assign(request: AssignRolesRequest) {
    request = AssignRolesRequest.self(request);
    await requireAdmin(request.auth);

    await AccountRoleService.assignPermissions(request.account_id, request.roles.permissions);
    return {};
}

async function accountRoles(request: AccountRolesRequest) {
    request = AccountRolesRequest.self(request);
    await requireAdmin(request.auth);

    const roles = await AccountRoleService.findByAccount(request.account_id);
    return { roles: roles.map(r => new RoleDTO(r)) };
}

export const roleMount = {
    routes: roleRoutes,
    handlers: { list, detail, create, update, delete: del, assign, account_roles: accountRoles },
};
