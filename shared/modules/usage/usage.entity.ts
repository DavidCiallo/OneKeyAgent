import { BaseEntity } from "../../lib/default/base.entity";

export interface UsageLogEntity extends BaseEntity {
    id: string;
    account_id: string;
    model_alias: string;
    provider_id?: string;
    input_tokens: number;
    output_tokens: number;
    input_price: number;
    output_price: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}