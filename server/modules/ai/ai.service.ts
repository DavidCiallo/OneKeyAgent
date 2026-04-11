import { nanoid } from "nanoid";
import {
    ChatCompletionsServiceResponse,
    CompletionServiceResponse,
    ModelsServiceResponse,
} from "../../../shared/modules/ai/ai.interface";

const models: Array<{ baseURL: string, model: string, apiKey?: string }> = [
    {
        baseURL: "http://192.168.1.110:11434/v1",
        model: "minimax-m2.7:cloud",
    },
    {
        baseURL: "http://192.168.1.110:11435/v1",
        model: "minimax-m2.7:cloud",
    },
    {
        baseURL: "http://192.168.1.110:11436/v1",
        model: "minimax-m2.7:cloud",
    }
]

async function chatHex(body: Record<string, any>): Promise<any> {
    const { baseURL, apiKey, model } = models[Math.floor(Math.random() * models.length)]
    const t0 = Date.now();
    const response = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            ...body,
            stream: false,
            model: model,
        }),
    });
    if (!response.ok) {
        throw new Error(`Hex API error: ${response.status}`);
    }
    const data = await response.json();
    const ms = Date.now() - t0;
    const { usage } = data;
    const tps = usage?.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
    console.log(baseURL)
    console.log(`[AI] input tokens: ${usage?.prompt_tokens}, output tokens: ${usage?.completion_tokens}, speed: ${tps} tok/s, ${ms}ms`);
    return data;
}

async function completeHex(body: any): Promise<any> {
    const { baseURL, apiKey, model } = models[Math.floor(Math.random() * models.length)]
    const t0 = Date.now();
    const response = await fetch(`${baseURL}/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            ...body,
            stream: false,
            model: model,
        }),
    });
    if (!response.ok) {
        throw new Error(`Hex API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const ms = Date.now() - t0;
    const { usage } = data;
    const tps = usage?.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
    console.log(`[AI] input tokens: ${usage?.prompt_tokens}, output tokens: ${usage?.completion_tokens}, speed: ${tps} tok/s, ${ms}ms`);
    return data;
}

export class AiService {
    static async chatCompletions(data: Record<string, any>): Promise<ChatCompletionsServiceResponse> {
        const responseText = await chatHex(data);
        return responseText as any
    }

    static async completions(body: any): Promise<CompletionServiceResponse> {
        const responseText = await completeHex(body);
        return responseText as any
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
