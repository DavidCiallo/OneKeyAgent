import {
    OllamaChatRequest,
    OllamaChatResponse,
    OllamaGenerateRequest,
    OllamaGenerateResponse,
    OllamaTagsRequest,
    OllamaTagsResponse,
} from "../../../shared/modules/ai/ai.ollama.interface";
import { AiOllamaRouterInstance } from "../../../shared/modules/ai/ai.ollama.router";
import { inject } from "../../lib/inject";
import { AiService } from "./ai.service";
import { validateApiKey, verifyApiKeyInDb } from "./ai.auth";

const CHUNK_COUNT = 15;
const HEARTBEAT_INTERVAL_MS = 8000;

function splitIntoChunks(text: string, count: number): string[] {
    if (!text) return [""];
    if (text.length <= count) return text.split("");
    const avgLen = Math.ceil(text.length / count);
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += avgLen) {
        chunks.push(text.slice(i, i + avgLen));
    }
    return chunks;
}

export const aiOllamaController = new AiOllamaRouterInstance(inject, {
    async chat(request): Promise<any> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        OllamaChatRequest.self(request);

        if (request.stream) {
            const model = request.model || "";
            const stream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    const created_at = new Date().toISOString();

                    const heartbeat = setInterval(() => {
                        try {
                            controller.enqueue(encoder.encode(JSON.stringify({
                                model,
                                created_at,
                                message: { role: "assistant", content: "" },
                                done: false,
                            }) + "\n"));
                        } catch (_) { /* 流已关闭，忽略 */ }
                    }, HEARTBEAT_INTERVAL_MS);

                    try {
                        // 阻塞等完整响应
                        const result = await AiService.chatCompletions(request, apiKey);
                        clearInterval(heartbeat);

                        const content = result.choices?.[0]?.message?.content || "";
                        const modelName = result.model || model;
                        const chunks = splitIntoChunks(content, CHUNK_COUNT);

                        for (let i = 0; i < chunks.length; i++) {
                            controller.enqueue(encoder.encode(JSON.stringify({
                                model: modelName,
                                created_at,
                                message: { role: "assistant", content: chunks[i] },
                                done: false,
                            }) + "\n"));
                            await new Promise(r => setTimeout(r, 20));
                        }

                        controller.enqueue(encoder.encode(JSON.stringify({
                            model: modelName,
                            created_at,
                            message: { role: "assistant", content: "" },
                            done: true,
                            done_reason: "stop",
                        }) + "\n"));
                    } catch (e: any) {
                        clearInterval(heartbeat);
                        controller.enqueue(encoder.encode(JSON.stringify({
                            model,
                            created_at,
                            message: { role: "assistant", content: `Error: ${e.message}` },
                            done: true,
                            done_reason: "error",
                        }) + "\n"));
                    }

                    controller.close();
                },
            });

            return new Response(stream as any, {
                headers: {
                    "Content-Type": "application/x-ndjson",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, token, Authorization",
                },
            });
        }

        const result = await AiService.chatCompletions(request, apiKey);
        console.log(new Date(), "Chat completion result:", request.model);
        return new OllamaChatResponse({
            id: result.id || `chatcmpl-${Date.now()}`,
            model: result.model,
            choices: result.choices?.map((c: any) => ({
                index: c.index,
                message: c.message,
                finish_reason: c.finish_reason,
            })) || [],
            usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
    },

    async generate(request): Promise<any> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        OllamaGenerateRequest.self(request);

        if (request.stream) {
            const model = request.model || "";
            const stream = new ReadableStream({
                async start(controller) {
                    const encoder = new TextEncoder();
                    const created_at = new Date().toISOString();

                    const heartbeat = setInterval(() => {
                        try {
                            controller.enqueue(encoder.encode(JSON.stringify({
                                model,
                                created_at,
                                response: "",
                                done: false,
                            }) + "\n"));
                        } catch (_) { }
                    }, HEARTBEAT_INTERVAL_MS);

                    try {
                        const result = await AiService.completions(request, apiKey);
                        clearInterval(heartbeat);

                        const text = result.choices?.[0]?.text || "";
                        const modelName = result.model || model;
                        const chunks = splitIntoChunks(text, CHUNK_COUNT);

                        for (let i = 0; i < chunks.length; i++) {
                            controller.enqueue(encoder.encode(JSON.stringify({
                                model: modelName,
                                created_at,
                                response: chunks[i],
                                done: false,
                            }) + "\n"));
                            await new Promise(r => setTimeout(r, 20));
                        }

                        controller.enqueue(encoder.encode(JSON.stringify({
                            model: modelName,
                            created_at,
                            response: "",
                            done: true,
                            done_reason: "stop",
                        }) + "\n"));
                    } catch (e: any) {
                        clearInterval(heartbeat);
                        controller.enqueue(encoder.encode(JSON.stringify({
                            model,
                            created_at,
                            response: `Error: ${e.message}`,
                            done: true,
                            done_reason: "error",
                        }) + "\n"));
                    }

                    controller.close();
                },
            });

            return new Response(stream as any, {
                headers: {
                    "Content-Type": "application/x-ndjson",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, token, Authorization",
                },
            });
        }

        const result = await AiService.completions(request, apiKey);
        return new OllamaGenerateResponse({
            model: result.model,
            choices: result.choices?.map((c: any) => ({
                text: c.text,
                finish_reason: c.finish_reason,
            })) || [],
            usage: result.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        });
    },

    async tags(request): Promise<OllamaTagsResponse> {
        OllamaTagsRequest.self(request);

        const data = await AiService.listModels();
        return new OllamaTagsResponse({
            models: (data.data || []).map((m: any) => ({
                name: m.id || "",
                modified_at: new Date((m.created || 0) * 1000).toISOString(),
                size: 0,
                digest: "",
                details: {
                    format: "gguf",
                    family: (m.id || "").split(":")[0] || m.id || "",
                    parameter_size: "",
                    quantization_level: "",
                },
            })),
        });
    },
});
