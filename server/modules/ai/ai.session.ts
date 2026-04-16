import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";
import { UsageLogEntity } from "../../../shared/modules/usage/usage.entity";
import { AiSessionEntity } from "../../../shared/modules/aisession/aisession.entity";

const modelRepo = Repository.instance<ModelEntity>("Model");
[
    { tier: 4, baseURL: "http://192.168.1.110:11434/v1", alias: "hex", model: "glm-5.1:cloud" },
].forEach(async i => {
    const exist = await modelRepo.findOne({ model: i.model, baseURL: i.baseURL });
    if (!exist) {
        modelRepo.insert(i);
    }
});
const sessionRepo = Repository.instance<AiSessionEntity>("AiSession");
const usageRepo = Repository.instance<UsageLogEntity>("UsageLog");

export function getSessionId(body: Record<string, any>): string {
    const msgs = body.messages || [];
    const key = msgs.slice(0, 3).map((m: { role: string; content: string }) => m.role + ":" + (m.content || "")).join("|");
    let h = 0;
    for (let i = 0; i < key.length; i++) {
        h = Math.imul(31, h) + key.charCodeAt(i) | 0;
    }
    return Math.abs(h).toString(36);
}

export async function getSession(sid: string): Promise<AiSessionEntity | null> {
    return await sessionRepo.findOne({ id: sid });
}

export async function createSession(sid: string, apiKey: string, modelId: string, messages: any[]) {
    await sessionRepo.insert({
        id: sid,
        apiKey,
        modelId,
        context: JSON.stringify(messages),
    });
}

export async function pickModel(session: AiSessionEntity): Promise<ModelEntity> {
    const m = await getModelById(session.modelId);
    if (m) return m;
    const models = await getAllModels();
    return models[0];
}

export async function updateSessionModel(sid: string, modelId: string): Promise<void> {
    await sessionRepo.update({ id: sid }, { modelId });
}

export async function logUsage(usage: {
    apiKey: string,
    sessionId: string,
    modelId: string,
    inputTokens: number,
    outputTokens: number
}) {
    await usageRepo.insert(usage);
}

export async function getAllModels(): Promise<ModelEntity[]> {
    return await modelRepo.find();
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
