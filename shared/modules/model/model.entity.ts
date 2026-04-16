import { BaseEntity } from "../../lib/default/base.entity";

export interface ModelEntity extends BaseEntity {
    id: string;
    tier: number;
    baseURL: string;
    model: string;
    alias?: string;
    apiKey?: string;
    proxyURL?: string;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}

export class ModelDTO {
    public id: string;
    public tier: number;
    public baseURL: string;
    public model: string;
    public alias?: string;
    public apiKey?: string;
    public proxyURL?: string;
    public create_time: number;
    public update_time: number;
    public delete_time: number | null;

    constructor(origin: ModelEntity) {
        this.id = origin.id;
        this.tier = origin.tier;
        this.baseURL = origin.baseURL;
        this.model = origin.model;
        this.alias = origin.alias;
        this.apiKey = origin.apiKey;
        this.proxyURL = origin.proxyURL;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}
