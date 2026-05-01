import { BaseEntity } from "../../lib/default/base.entity";

export interface TaskEntity extends BaseEntity {
    account_id: string;
    task_text: string;
    folder: string | null;
    status: string; // pending | processing | completed | failed
}
