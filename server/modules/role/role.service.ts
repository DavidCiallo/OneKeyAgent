import Repository from "../../lib/repository";
import { RoleEntity, AccountRoleEntity, RoleType } from "../../../shared/modules/role/role.entity";

const roleRepository: Repository<RoleEntity> = Repository.instance("Role");
const accountRoleRepository: Repository<AccountRoleEntity> = Repository.instance("AccountRole");

export class RoleService {
    static async find(page: number, filter: Partial<RoleEntity>): Promise<{ list: RoleEntity[], total: number }> {
        const list = await roleRepository.find(filter, { offset: (page - 1) * 10, limit: 10 });
        const total = await roleRepository.count(filter);
        return { list, total };
    }

    static async findOne(id: string): Promise<RoleEntity | null> {
        return await roleRepository.findOne({ id });
    }

    static async create(data: Partial<RoleEntity>): Promise<RoleEntity> {
        return await roleRepository.insert(data);
    }

    static async update(id: string, data: Partial<RoleEntity>): Promise<RoleEntity | null> {
        await roleRepository.update({ id }, data);
        return await roleRepository.findOne({ id });
    }

    static async delete(id: string): Promise<void> {
        await roleRepository.delete({ id });
    }

    /** Find or create a role by name+type, return its id */
    static async findOrCreate(name: string, type: RoleType): Promise<string> {
        const existing = await roleRepository.findIgnoreDelete({ name, type });
        if (existing) return existing.id;
        const role = await roleRepository.insert({ name, type });
        return role.id;
    }
}

export class AccountRoleService {
    static async findByAccount(accountId: string): Promise<RoleEntity[]> {
        const relations = await accountRoleRepository.find({ account_id: accountId });
        if (relations.length === 0) return [];
        const roleIds = relations.map(r => r.role_id);
        return await roleRepository.findByIds(roleIds);
    }

    static async assignPermissions(accountId: string, permissions: { name: string; type: string }[]): Promise<void> {
        // Delete existing assignments in a single batch
        const existing = await accountRoleRepository.find({ account_id: accountId });
        for (const rel of existing) {
            await accountRoleRepository.delete({ id: rel.id });
        }
        // Find or create each role, then assign
        for (const perm of permissions) {
            const roleId = await RoleService.findOrCreate(perm.name, perm.type as RoleType);
            await accountRoleRepository.insert({ account_id: accountId, role_id: roleId });
        }
    }
}
