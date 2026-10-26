import { BaseEntity } from "../../lib/default/base.entity";

export interface ProviderEntity extends BaseEntity {
    id: string;
    model_alias: string;
    priority: number;
    name: string;
    base_url: string;
    model: string;
    api_key?: string;
    auth_type?: string;
    api_type?: string;
    proxy_url?: string;
    supports_thinking?: number;
    supports_reasoning_effort?: number;
    replay_reasoning?: number;
    enable_search?: number;
    extra_json?: string;
    /** JSON array of tool names to remove from a request before it is relayed. */
    /** JSON array of {"from","to"} literal replacements over system messages. */
    prompt_replace?: string;
    enabled: number;
    /** Context window in tokens; 0 = unlimited. */
    max_context?: number;
    /** How long each streamed block is held back, in ms; 0 = no wait. */
    chunk_delay_ms?: number;
    /** Minutes past routing-local midnight; both 0 = any time. */
    active_from?: number;
    active_to?: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}
