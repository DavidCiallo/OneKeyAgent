import { BaseEntity } from "../../lib/default/base.entity";

export interface ModelEntity extends BaseEntity {
    id: string;
    alias: string;
    input_price: number;
    cache_price: number;
    output_price: number;
    is_public: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}

export class ModelDTO {
    public id: string;
    public alias: string;
    public input_price: number;
    public output_price: number;
    public is_public: number;
    public create_time: number;
    public update_time: number | null;
    public delete_time: number | null;

    constructor(origin: ModelEntity) {
        this.id = origin.id;
        this.alias = origin.alias;
        this.input_price = origin.input_price;
        this.cache_price = origin.cache_price;
        this.output_price = origin.output_price;
        this.is_public = origin.is_public;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}
