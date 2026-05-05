import { BaseEntity } from "../../lib/default/base.entity";

export type RoleType = "menu" | "page" | "api" | "model";

export interface RoleEntity extends BaseEntity {
    name: string;
    type: RoleType;
}

export class RoleDTO {
    public id: string;
    public name: string;
    public type: string;
    public create_time: number;
    public update_time: number | null;
    public delete_time: number | null;

    constructor(origin: RoleEntity) {
        this.id = origin.id;
        this.name = origin.name;
        this.type = origin.type;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}

export interface AccountRoleEntity extends BaseEntity {
    account_id: string;
    role_id: string;
}

export class AccountRoleDTO {
    public id: string;
    public account_id: string;
    public role_id: string;
    public create_time: number;
    public update_time: number | null;
    public delete_time: number | null;

    constructor(origin: AccountRoleEntity) {
        this.id = origin.id;
        this.account_id = origin.account_id;
        this.role_id = origin.role_id;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}