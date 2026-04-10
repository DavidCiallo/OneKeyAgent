import { BaseEntity } from "../../lib/default/base.entity";

export interface AccountEntity extends BaseEntity {
    name: string;
    email: string;
    password: string;
}