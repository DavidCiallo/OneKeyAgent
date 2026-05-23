import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";

const modelRepo = Repository.instance<ModelEntity>("Model");
const providerRepo = Repository.instance<ProviderEntity>("Provider");
const usageRepo = Repository.instance<UsageLogEntity>("usage_log");

/** Ensure the 'hex' model exists in the database */
export async function seedDefaultModel() {
    // const models = await modelRepo.find();
    // const hasHex = models.some(m => m.alias === "hex");
    // if (!hasHex) {
    //     await modelRepo.insert({ alias: "hex" });
    //     console.log("[Seed] Created default model 'hex'");
    // }
}

export async function logUsage(usage: {
    account_id: string,
    model_alias: string,
    provider_id?: string,
    input_tokens: number,
    output_tokens: number,
    input_price: number,
    output_price: number,
}) {
    await usageRepo.insert(usage);
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
