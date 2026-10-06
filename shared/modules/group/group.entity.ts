import { BaseEntity } from "../../lib/default/base.entity";

/**
 * An organisational group of accounts.
 *
 * Deliberately separate from `role`: that table is a permission system whose
 * rows are menu/button entries, so it answers "what may this account reach".
 * A group answers "which accounts do I want to look at together", and its one
 * consumer is the usage filter.
 */
export interface AccountGroupEntity extends BaseEntity {
    id: string;
    name: string;
    remark: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
}

/** Membership row. Multi-group: an account can be in several groups at once. */
export interface AccountGroupMemberEntity extends BaseEntity {
    id: string;
    group_id: string;
    account_id: string;
    create_time: number;
    update_time: number | null;
    delete_time: number | null;
}
