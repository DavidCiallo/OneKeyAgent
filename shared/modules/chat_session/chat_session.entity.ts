import { BaseEntity } from "../../lib/default/base.entity";

export interface ChatSessionEntity extends BaseEntity {
    user_id: string;
    title: string;
}