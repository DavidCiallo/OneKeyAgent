import { BaseEntity } from "../../lib/default/base.entity";

export interface ProviderEntity extends BaseEntity {
    id: string;
    modelAlias: string;
    priority: number;
    name: string;
    baseURL: string;
    model: string;
    apiKey?: string;
    proxyURL?: string;
    enabled: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}
