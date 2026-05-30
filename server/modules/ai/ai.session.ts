import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { BucketManager } from "../usage/usage_bucket";

const modelRepo = Repository.instance<ModelEntity>("Model");

export async function logUsage(usage: {
    account_id: string,
    model_alias: string,
    provider_id?: string,
    input_tokens: number,
    output_tokens: number,
    input_price: number,
    output_price: number,
}) {
    const cost = Math.round((usage.input_tokens * (usage.input_price || 0) + usage.output_tokens * (usage.output_price || 0)) / 1_000_000 * 1_000_000) / 1_000_000;
    BucketManager.instance.accumulate({
        account_id: usage.account_id,
        model_alias: usage.model_alias,
        provider_id: usage.provider_id || "unknown",
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cost,
    });
}

export async function getAllModels(): Promise<ModelEntity[]> {
    const list = await modelRepo.find({ delete_time: null });
    return list.sort((a, b) => a.alias.localeCompare(b.alias));
}

export async function getModelById(id: string): Promise<ModelEntity | null> {
    return await modelRepo.findOne({ id });
}

export async function getModelsByAlias(name: string): Promise<ModelEntity[]> {
    const all = await getAllModels();
    return all.filter(m => m.alias === name);
}
