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

function createChatStream(
    content: string,
    model: string,
): ReadableStream<Uint8Array> {
    const created_at = new Date().toISOString();
    return new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const chunks = splitIntoChunks(content, CHUNK_COUNT);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = {
                    model,
                    created_at,
                    message: { role: "assistant", content: chunks[i] },
                    done: false,
                };
                controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
                await new Promise(r => setTimeout(r, 20));
            }

            const doneChunk = {
                model,
                created_at,
                message: { role: "assistant", content: "" },
                done: true,
                done_reason: "stop",
            };
            controller.enqueue(encoder.encode(JSON.stringify(doneChunk) + "\n"));
            controller.close();
        },
    });
}

function createGenerateStream(
    text: string,
    model: string,
): ReadableStream<Uint8Array> {
    const created_at = new Date().toISOString();
    return new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const chunks = splitIntoChunks(text, CHUNK_COUNT);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = {
                    model,
                    created_at,
                    response: chunks[i],
                    done: false,
                };
                controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
                await new Promise(r => setTimeout(r, 20));
            }

            const doneChunk = {
                model,
                created_at,
                response: "",
                done: true,
                done_reason: "stop",
            };
            controller.enqueue(encoder.encode(JSON.stringify(doneChunk) + "\n"));
            controller.close();
        },
    });
}

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

        const result = await AiService.chatCompletions(request, apiKey);
        console.log(new Date(), "Chat completion result:", request.model);
        if (request.stream) {
            const content = result.choices?.[0]?.message?.content || "";
            const model = result.model || request.model || "";
            const stream = createChatStream(content, model);
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

        const result = await AiService.completions(request, apiKey);

        if (request.stream) {
            const text = result.choices?.[0]?.text || "";
            const model = result.model || request.model || "";
            const stream = createGenerateStream(text, model);
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
        return new OllamaTagsResponse(data);
    },
});
