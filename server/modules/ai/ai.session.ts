import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";

const modelRepo = Repository.instance<ModelEntity>("Model");
[
    { tier: 4, baseURL: "http://192.168.1.110:11434/v1", alias: "bin", model: "deepseek-v4-flash:cloud" },
].forEach(async i => {
    const exist = await modelRepo.findOne({ model: i.model, baseURL: i.baseURL });
    if (!exist) {
        modelRepo.insert(i);
    }
});

const usageRepo = Repository.instance<UsageLogEntity>("UsageLog");

export async function logUsage(usage: {
    apiKey: string,
    modelId: string,
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
    let matched = all.filter(m => m.alias === name);
    if (matched.length === 0) {
        matched = all.filter(m => m.model === name);
    }
    return matched.sort((a, b) => b.tier - a.tier);
}
