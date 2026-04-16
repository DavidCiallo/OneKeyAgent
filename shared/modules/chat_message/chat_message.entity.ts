import { BaseEntity } from "../../lib/default/base.entity";

export interface ChatMessageEntity extends BaseEntity {
    session_id: string;
    role: "user" | "assistant" | "system";
    content: string;
}