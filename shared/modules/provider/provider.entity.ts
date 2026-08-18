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
    enabled: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}
