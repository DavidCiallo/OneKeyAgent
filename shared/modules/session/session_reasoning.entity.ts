import { BaseEntity } from "../../lib/default/base.entity";

export interface SessionReasoningEntity extends BaseEntity {
    id: string;
    session_key: string;
    tool_call_id: string;
    reasoning_content: string;
}
