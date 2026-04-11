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
    getModelById,
    pickModelWithFallback,
    incrementFailureCount,
    resetFailureCount,
    updateSessionModel,
    getFirstModelByAlias
} from "./ai.session";
// @ts-ignore
import fs from "fs";

const MAX_FAILURES_BEFORE_SWITCH = 3;

async function chatHex(body: Record<string, any>, apiKey: string): Promise<any> {
    const t0 = Date.now();
    const sid = getSessionId(body);
    const session = await getSession(sid);

    const models = await getAllModels();
    let model = session ? await pickModel(session) : models[0];
    let attemptModel = false;

    // 检查是否需要更换模型（连续失败）
    if (session && session.failureCount >= MAX_FAILURES_BEFORE_SWITCH) {
        model = await pickModelWithFallback(session);
        attemptModel = true;
    }

    const requestBody: Record<string, any> = {
        ...body,
        stream: false,
        model: model.model,
    };

    const response = await fetch(`${model.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${model.apiKey}` },
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
        const errorText = await response.text();
        const failureCount = await incrementFailureCount(sid);

        // 尝试更换相同 alias 的模型
        if (failureCount < MAX_FAILURES_BEFORE_SWITCH && session) {
            const altModel = await pickModelWithFallback(session);
            console.log(`[AI] Request failed (${response.status}), trying ${altModel.alias}:${altModel.baseURL}`);

            const retryResponse = await fetch(`${altModel.baseURL}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${altModel.apiKey}` },
                body: JSON.stringify({ ...requestBody, model: altModel.model }),
            });

            if (retryResponse.ok) {
                const data = await retryResponse.json();
                await resetFailureCount(sid);
                await updateSessionModel(sid, altModel.id);
                return data;
            } else {
                await incrementFailureCount(sid);
                throw new Error(`All ${altModel.alias} models failed: ${retryResponse.status}`);
            }
        }

        throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const ms = Date.now() - t0;

    // 成功后重置失败计数
    if (session) {
        await resetFailureCount(sid);
        if (attemptModel) {
            await updateSessionModel(sid, model.id);
        }
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
    console.log(`[AI] input: ${usage?.prompt_tokens}, output: ${usage?.completion_tokens}, ${tps} tok/s, ${ms}ms`);
    return data;
}

async function completeHex(body: Record<string, any>, apiKey: string): Promise<any> {
    const t0 = Date.now();
    const sid = getSessionId(body);
    const session = await getSession(sid);
    const models = await getAllModels();
    const model = session ? await pickModel(session) : models[0];

    const response = await fetch(`${model.baseURL}/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${model.apiKey}` },
        body: JSON.stringify({
            ...body,
            stream: false,
            model: model.model,
        }),
    });
    if (!response.ok) {
        throw new Error(`Hex API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const ms = Date.now() - t0;
    const { usage } = data;

    await logUsage({
        apiKey,
        sessionId: sid,
        modelId: model.id,
        inputTokens: usage.prompt_tokens || 0,
        outputTokens: usage.completion_tokens || 0,
    });

    const tps = usage?.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
    console.log(`[AI] input: ${usage?.prompt_tokens}, output: ${usage?.completion_tokens}, ${tps} tok/s, ${ms}ms`);
    return data;
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
                id: m.id,
                object: "model",
                created: m.create_time,
                owned_by: "onekey",
            })),
        };
    }
}
