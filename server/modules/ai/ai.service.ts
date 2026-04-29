import { fetch, ProxyAgent } from "undici";
import {
    ChatCompletionsServiceResponse,
    CompletionServiceResponse,
    ModelsServiceResponse,
} from "../../../shared/modules/ai/ai.interface";
import { getAllModels, getModelsByAlias, logUsage, } from "./ai.session";

async function chatHex(body: Record<string, any>, apiKey: string): Promise<any> {
    const t0 = Date.now();

    const requestedAlias = body.model;
    const models = await getModelsByAlias(requestedAlias);
    if (models.length === 0) throw new Error(`No models found for alias: ${requestedAlias}`);

    for (let count = 0; count < 100; count++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        for (const model of models) {
            console.log(`[AI] Trying model: ${model.model}`);
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

async function safePipe(reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>) {
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writer.write(value);
        }
        await writer.close();
    } catch (err) {
        console.log(`[AI] stream closed: ${(err as Error)?.message || 'unknown'}`);
    }
}

/**
 * 真流式 chat completions：将 stream: true 传给上游，原封不动转发 upstream 的 SSE chunk
 * 通过 tee() 分流 + 安全管道，杜绝 UND_ERR_SOCKET 传到客户端
 */
async function chatHexStream(body: Record<string, any>, apiKey: string): Promise<ReadableStream<Uint8Array>> {
    const requestedAlias = body.model;
    const models = await getModelsByAlias(requestedAlias);
    if (models.length === 0) throw new Error(`No models found for alias: ${requestedAlias}`);

    for (let count = 0; count < 100; count++) {
        await new Promise(resolve => setTimeout(resolve, 300));
        for (const model of models) {
            try {
                const requestBody: Record<string, any> = {
                    ...body,
                    stream: true,
                    thinking: { type: "disabled" },
                    model: model.model,
                };

                const t0 = Date.now();
                const response = await fetch(`${model.baseURL}/chat/completions`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${model.apiKey}` },
                    body: JSON.stringify(requestBody),
                    dispatcher: model.proxyURL ? new ProxyAgent(model.proxyURL) : undefined,
                    signal: AbortSignal.timeout(300_000), // 5分钟超时
                });

                if (!response.ok) continue;

                // tee 分流
                const [upstreamForward, parseStream] = (response.body!.tee() as [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>]);

                // 用 TransformStream 包装，通过 safePipe 泵送
                const ts = new TransformStream<Uint8Array, Uint8Array>();
                const forwardStream = ts.readable;
                safePipe(upstreamForward.getReader(), ts.writable.getWriter());

                // 后台异步解析 usage
                (async () => {
                    try {
                        const reader = parseStream.getReader();
                        const decoder = new TextDecoder();
                        let usage: any = null;

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            const text = decoder.decode(value, { stream: true });
                            const lines = text.split('\n');
                            for (const line of lines) {
                                if (line.startsWith('data: ') && !line.startsWith('data: [DONE]')) {
                                    try {
                                        const data = JSON.parse(line.slice(6));
                                        if (data.usage) {
                                            usage = data.usage;
                                        }
                                    } catch {}
                                }
                            }
                        }

                        if (usage) {
                            const ms = Date.now() - t0;
                            const tps = usage.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
                            console.log(`[AI] ${model.model} stream - input: ${usage.prompt_tokens}, output: ${usage.completion_tokens}, ${tps} tok/s, ${ms}ms`);
                            await logUsage({
                                apiKey,
                                modelId: model.id,
                                inputTokens: usage.prompt_tokens || 0,
                                outputTokens: usage.completion_tokens || 0,
                            });
                        }
                    } catch (err) {
                        console.log(`[AI] parse stream closed: ${(err as Error)?.message || 'unknown'}`);
                    }
                })();

                return forwardStream;

            } catch (e) {
                continue;
            }
        }
    }

    throw new Error("All models failed for streaming");
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

/**
 * completions 流式转发（带安全管道）
 */
async function completeHexStream(body: Record<string, any>, apiKey: string): Promise<ReadableStream<Uint8Array>> {
    const requestedAlias = body.model;
    const models = await getModelsByAlias(requestedAlias);
    if (models.length === 0) throw new Error(`No models found for alias: ${requestedAlias}`);

    for (let tier = models[0].tier; tier >= 1; tier--) {
        for (const model of models) {
            try {
                const response = await fetch(`${model.baseURL}/completions`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", 'Authorization': `Bearer ${model.apiKey}` },
                    body: JSON.stringify({ ...body, stream: true, model: model.model }),
                    dispatcher: model.proxyURL ? new ProxyAgent(model.proxyURL) : undefined,
                    signal: AbortSignal.timeout(300_000),
                });

                if (!response.ok) continue;

                // 通过安全管道转发，吞掉 socket 断开错误
                const ts = new TransformStream<Uint8Array, Uint8Array>();
                const forwardStream = ts.readable;
                safePipe(response.body!.getReader(), ts.writable.getWriter());

                return forwardStream;

            } catch (e) {
                console.log(`[AI] tier${tier} ${model.baseURL} failed: ${e}`);
                continue;
            }
        }
    }

    throw new Error("All models failed for streaming");
}

export class AiService {
    static async chatCompletions(data: Record<string, any>, apiKey: string = ""): Promise<ChatCompletionsServiceResponse> {
        return await chatHex(data, apiKey) as any;
    }

    static async chatCompletionsStream(data: Record<string, any>, apiKey: string = ""): Promise<ReadableStream<Uint8Array>> {
        return await chatHexStream(data, apiKey);
    }

    static async completions(data: Record<string, any>, apiKey: string = ""): Promise<CompletionServiceResponse> {
        return await completeHex(data, apiKey);
    }

    static async completionsStream(data: Record<string, any>, apiKey: string = ""): Promise<ReadableStream<Uint8Array>> {
        return await completeHexStream(data, apiKey);
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
