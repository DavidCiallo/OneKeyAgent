import Repository from "../../lib/repository";
import {
    aiSessionTable,
    modelTable,
    usageLogTable
} from "../../lib/schema";

// 定义实体类以便 Repository 使用
export interface ModelEntity {
    id: string;
    alias: string;
    baseURL: string;
    model: string;
    apiKey?: string;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}

export interface AiSessionEntity {
    id: string;
    apiKey: string;
    modelId: string;
    context: string; // JSON string
    failureCount: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}

export interface UsageLogEntity {
    id: string;
    apiKey: string;
    sessionId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}

const modelRepo = Repository.instance<ModelEntity>("Model");
[
    {
        "alias": "minimax-m2.7",
        "baseURL": "http://192.168.1.2:11434/v1",
        "apiKey": "",
        "model": "minimax-m2.7:cloud",
    },
].forEach(async i => {
    const exist = await modelRepo.findOne({ model: i.model, baseURL: i.baseURL });
    if (!exist) {
        modelRepo.insert({ model: i.model, baseURL: i.baseURL, apiKey: i.apiKey || "", alias: i.alias })
    }
})
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
        failureCount: 0
    });
}

export async function pickModel(session: AiSessionEntity): Promise<ModelEntity> {
    const m = await getModelById(session.modelId);
    if (m) return m;
    const models = await getAllModels();
    return models[0];
}

export async function getModelsByAlias(alias: string): Promise<ModelEntity[]> {
    return await modelRepo.find({ alias });
}

export async function getFirstModelByAlias(alias: string): Promise<ModelEntity | null> {
    const models = await getModelsByAlias(alias);
    return models[0] || null;
}

export async function incrementFailureCount(sid: string): Promise<number> {
    const session = await sessionRepo.findOne({ id: sid });
    if (!session) return 0;
    const newCount = (session.failureCount || 0) + 1;
    await sessionRepo.update({ id: sid }, { failureCount: newCount });
    return newCount;
}

export async function resetFailureCount(sid: string): Promise<void> {
    await sessionRepo.update({ id: sid }, { failureCount: 0 });
}

export async function updateSessionModel(sid: string, modelId: string): Promise<void> {
    await sessionRepo.update({ id: sid }, { modelId });
}

export async function pickModelWithFallback(session: AiSessionEntity): Promise<ModelEntity> {
    const currentModel = await pickModel(session);
    const aliases = await getModelsByAlias(currentModel.alias);

    if (aliases.length <= 1) {
        return currentModel;
    }

    // 随机选一个不同的模型
    const others = aliases.filter(m => m.id !== currentModel.id);
    if (others.length === 0) return currentModel;
    return others[Math.floor(Math.random() * others.length)];
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
