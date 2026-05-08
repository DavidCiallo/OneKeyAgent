import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";

const modelRepo = Repository.instance<ModelEntity>("Model");
const providerRepo = Repository.instance<ProviderEntity>("Provider");
const usageRepo = Repository.instance<UsageLogEntity>("UsageLog");

/** Ensure the 'hex' model exists in the database */
export async function seedDefaultModel() {
    // const models = await modelRepo.find();
    // const hasHex = models.some(m => m.alias === "hex");
    // if (!hasHex) {
    //     await modelRepo.insert({ alias: "hex", tier: 1 });
    //     console.log("[Seed] Created default model 'hex'");
    // }
}

export async function logUsage(usage: {
    accountId: string,
    modelAlias: string,
    providerId?: string,
    inputTokens: number,
    outputTokens: number,
    tierSnapshot?: number,
}) {
    await usageRepo.insert(usage);
}

export async function getAllModels(): Promise<ModelEntity[]> {
    return await modelRepo.find({ delete_time: null });
}

export async function getModelById(id: string): Promise<ModelEntity | null> {
    return await modelRepo.findOne({ id });
}

export async function getModelsByAlias(name: string): Promise<ModelEntity[]> {
    const all = await getAllModels();
    return all.filter(m => m.alias === name).sort((a, b) => b.tier - a.tier);
}
