import { fetch, ProxyAgent } from "undici";
import {
    ChatCompletionsServiceResponse,
    CompletionServiceResponse,
    ModelsServiceResponse,
} from "../../../shared/modules/ai/ai.interface";
import { getAllModels, getModelsByAlias, logUsage, } from "./ai.session";
// @ts-ignore

async function chatHex(body: Record<string, any>, apiKey: string): Promise<any> {
    const t0 = Date.now();

    const requestedAlias = body.model;
    const models = await getModelsByAlias(requestedAlias);
    if (models.length === 0) throw new Error(`No models found for alias: ${requestedAlias}`);


    for (let count = 0; count < 100; count++) {
        await new Promise(resolve => setTimeout(resolve, 300));

        for (const model of models) {
            const requestBody: Record<string, any> = {
                ...body,
                stream: false,
                thinking: { type: "disabled" },
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
                continue;
            }
            if (!response.ok) continue;

            const data = await response.json();
            const ms = Date.now() - t0;

            const { usage } = data;
            console.log(`[AI] Raw usage data:`, JSON.stringify(usage));
            await logUsage({
                apiKey,
                modelId: model.id,
                inputTokens: usage?.prompt_tokens || 0,
                outputTokens: usage?.completion_tokens || 0,
            });

            const tps = usage?.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
            console.log(`[AI] ${model.model} input: ${usage?.prompt_tokens}, output: ${usage?.completion_tokens}, ${tps} tok/s, ${ms}ms`);

            if (model.alias) {
                data.model = model.alias;
            }

            return data;
        }
    }

    throw new Error("All models failed");
}

async function completeHex(body: Record<string, any>, apiKey: string): Promise<any> {
    const t0 = Date.now();

    const requestedAlias = body.model;
    const models = await getModelsByAlias(requestedAlias);
    if (models.length === 0) throw new Error(`No models found for alias: ${requestedAlias}`);

    for (let tier = models[0].tier; tier >= 1; tier--) {

        for (const model of models) {
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

            const { usage } = data;
            await logUsage({
                apiKey,
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
        let res = null;
        return await completeHex(data, apiKey);
    }

    static async listModels(): Promise<ModelsServiceResponse> {
        const models = await getAllModels();
        const seen = new Set<string>();
        const data = [];
        for (const m of models) {
            const name = m.alias || "";
            if (name && !seen.has(name)) {
                seen.add(name);
                data.push({
                    id: name,
                    object: "model",
                    created: m.create_time,
                    owned_by: "onekey",
                });
            }
        }
        return { data };
    }
}
