import {
    ChatCompletionsServiceResponse,
    CompletionServiceResponse,
    ModelsServiceResponse,
} from "../../../shared/modules/ai/ai.interface";
import { getSessionId, getSession, createSession, updateUsage, getAllModels, pickModel, touchSession } from "./ai.session";
// @ts-ignore
import fs from "fs";

async function chatHex(body: Record<string, any>): Promise<any> {
    const t0 = Date.now();
    const sid = getSessionId(body);
    let session = getSession(sid);

    // 先选模型（会自动换模型）
    const model = session ? pickModel(session) : getAllModels()[0];

    const requestBody: Record<string, any> = {
        ...body,
        stream: false,
        model: model.model,
    };
    if (session) {
        touchSession(sid);
        requestBody.context = session.context;
    }

    const response = await fetch(`${model.baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${model.apiKey}` },
        body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
        throw new Error(`Hex API error: ${response.status}`);
    }
    const data = await response.json();
    const ms = Date.now() - t0;

    if (data.context) {
        createSession(sid, 0, data.context);
    } else if (!session) {
        createSession(sid, 0, []);
    }

    const { usage } = data;
    updateUsage(sid, usage.prompt_tokens || 0, usage.completion_tokens || 0);

    const tps = usage?.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
    console.log(`[AI] input: ${usage?.prompt_tokens}, output: ${usage?.completion_tokens}, ${tps} tok/s, ${ms}ms`);
    return data;
}

async function completeHex(body: Record<string, any>): Promise<any> {
    const t0 = Date.now();
    const sid = getSessionId(body);
    let session = getSession(sid);
    const model = session ? pickModel(session) : getAllModels()[0];

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
    const tps = usage?.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
    console.log(`[AI] input: ${usage?.prompt_tokens}, output: ${usage?.completion_tokens}, ${tps} tok/s, ${ms}ms`);
    return data;
}

export class AiService {
    static async chatCompletions(data: Record<string, any>): Promise<ChatCompletionsServiceResponse> {
        return await chatHex(data) as any;
    }

    static async completions(data: Record<string, any>): Promise<CompletionServiceResponse> {
        return await completeHex(data) as any;
    }

    static async listModels(): Promise<ModelsServiceResponse> {
        return {
            data: [
                {
                    id: "hex",
                    object: "model",
                    created: Date.now(),
                    owned_by: "onekey",
                },
            ],
        };
    }
}
