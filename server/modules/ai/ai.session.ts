import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";

const modelRepo = Repository.instance<ModelEntity>("Model");
const providerRepo = Repository.instance<ProviderEntity>("Provider");
const usageRepo = Repository.instance<UsageLogEntity>("UsageLog");

export async function seedDefaultModel() {
    const existing = await modelRepo.find();
    if (existing.length === 0) {
        await modelRepo.insert({ alias: "bin", tier: 1 });
        await providerRepo.insert({
            modelAlias: "bin",
            priority: 1,
            name: "Ollama",
            baseURL: "http://127.168.0.1:11434/v1",
            model: "deepseek-v4-flash:cloud",
            apiKey: "",
            enabled: 0,
        });
        console.log("[Seed] Created default model 'bin' with provider");
    }
}

export async function logUsage(usage: {
    accountId: string,
    modelAlias: string,
    providerId?: string,
    inputTokens: number,
    outputTokens: number
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
