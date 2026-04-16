import { fetch, ProxyAgent } from "undici";
import {
    ChatCompletionsServiceResponse,
    CompletionServiceResponse,
    ModelsServiceResponse,
} from "../../../shared/modules/ai/ai.interface";
import {
    getSessionId,
    getSession,
    createSession,
    getAllModels,
    pickModel,
    logUsage,
    updateSessionModel,
} from "./ai.session";
// @ts-ignore

async function chatHex(body: Record<string, any>, apiKey: string): Promise<any> {
    const t0 = Date.now();
    const sid = getSessionId(body);
    const session = await getSession(sid);

    const models = await getAllModels();
    models.sort((a, b) => b.tier - a.tier)
    const startModel = session ? await pickModel(session) : models[0];
    const startTier = startModel.tier;

    // 从最高 tier 开始，失败则降级，同 tier 随机顺序
    const tried = new Set<string>();

    // for (let tier = startTier; tier >= 1; tier--) {
    for (let count = 0; count < 100; count++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        // const tierModels = models.filter(m => m.tier === tier && !tried.has(m.id));
        const tierModels = models;
        if (tierModels.length === 0) continue;

        // 同 tier 随机打乱
        for (let i = tierModels.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tierModels[i], tierModels[j]] = [tierModels[j], tierModels[i]];
        }

        for (const model of tierModels) {
            tried.add(model.id);
            const requestBody: Record<string, any> = {
                ...body,
                stream: false,
                model: model.model,
            };

            let response: any;
            try {
                response = await fetch(`${model.baseURL}/chat/completions`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${model.apiKey}` },
                    body: JSON.stringify(requestBody),
                    dispatcher: model.proxyURL ? new ProxyAgent(model.proxyURL) : undefined,
                });
            } catch (e) {
                console.log(`[AI] ${model.baseURL} failed: ${e}`);
                continue;
            }

            if (!response.ok) {
                console.log(`[AI] ${model.baseURL} error: ${response.status}, ${response.statusText}`);
                continue;
            }

            const data = await response.json();
            const ms = Date.now() - t0;

            if (session) {
                await updateSessionModel(sid, model.id);
            } else {
                await createSession(sid, apiKey, model.id, body.messages);
            }

            const { usage } = data;
            console.log(`[AI] Raw usage data:`, JSON.stringify(usage));
            await logUsage({
                apiKey,
                sessionId: sid,
                modelId: model.id,
                inputTokens: usage?.prompt_tokens || 0,
                outputTokens: usage?.completion_tokens || 0,
            });

            const tps = usage?.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
            console.log(`[AI] ${model.model} input: ${usage?.prompt_tokens}, output: ${usage?.completion_tokens}, ${tps} tok/s, ${ms}ms`);
            return data;
        }
    }

    throw new Error("All models failed");
}

async function completeHex(body: Record<string, any>, apiKey: string): Promise<any> {
    const t0 = Date.now();
    const sid = getSessionId(body);
    const session = await getSession(sid);

    const models = await getAllModels();
    const startModel = session ? await pickModel(session) : models[0];
    const startTier = startModel.tier;

    const tried = new Set<string>();

    for (let tier = startTier; tier >= 1; tier--) {
        const tierModels = models.filter(m => m.tier === tier && !tried.has(m.id));
        if (tierModels.length === 0) continue;

        for (let i = tierModels.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tierModels[i], tierModels[j]] = [tierModels[j], tierModels[i]];
        }

        for (const model of tierModels) {
            tried.add(model.id);
            let response: any;
            try {
                response = await fetch(`${model.baseURL}/completions`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${model.apiKey}` },
                    body: JSON.stringify({ ...body, stream: false, model: model.model }),
                    dispatcher: model.proxyURL ? new ProxyAgent(model.proxyURL) : undefined,
                });
            } catch (e) {
                console.log(`[AI] tier${tier} ${model.baseURL} failed: ${e}`);
                continue;
            }

            if (!response.ok) {
                console.log(`[AI] tier${tier} ${model.baseURL} error: ${response.status}`);
                continue;
            }

            const data = (await response.json()) as { usage: { prompt_tokens: number, completion_tokens: number } };
            const ms = Date.now() - t0;

            if (session) {
                await updateSessionModel(sid, model.id);
            } else {
                await createSession(sid, apiKey, model.id, body.messages);
            }

            const { usage } = data;
            await logUsage({
                apiKey,
                sessionId: sid,
                modelId: model.id,
                inputTokens: usage?.prompt_tokens || 0,
                outputTokens: usage?.completion_tokens || 0,
            });

            const tps = usage?.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
            console.log(`[AI] tier${tier} input: ${usage?.prompt_tokens}, output: ${usage?.completion_tokens}, ${tps} tok/s, ${ms}ms`);
            return data;
        }
    }

    throw new Error("All models failed");
}

export class AiService {
    static async chatCompletions(data: Record<string, any>, apiKey: string = ""): Promise<ChatCompletionsServiceResponse> {
        return await chatHex(data, apiKey) as any;
    }

    static async completions(data: Record<string, any>, apiKey: string = ""): Promise<CompletionServiceResponse> {
        return await completeHex(data, apiKey) as any;
    }

    static async listModels(): Promise<ModelsServiceResponse> {
        const models = await getAllModels();
        return {
            data: models.map(m => ({
                id: m.model,
                object: "model",
                created: m.create_time,
                owned_by: "onekey",
            })),
        };
    }
}
