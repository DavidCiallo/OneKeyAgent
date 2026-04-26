import {
    ChatCompletionsRequest,
    CompletionRequest,
    ModelsRequest,
    ModelsResponse,
} from "../../../shared/modules/ai/ai.interface";
import { AiRouterInstance } from "../../../shared/modules/ai/ai.router";
import { inject } from "../../lib/inject";
import { AiService } from "./ai.service";
import { validateApiKey, verifyApiKeyInDb } from "./ai.auth";
import { createPseudoCompletionStream, createPseudoStream } from "./ai.stream";

export const aiController = new AiRouterInstance(inject, {
    async chatcompletions(request): Promise<any> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        const req = ChatCompletionsRequest.self(request);

        const result = await AiService.chatCompletions(request, apiKey);

        if (request.stream) {
            const content = result.choices?.[0]?.message?.content || "";
            const toolCalls = (result.choices?.[0]?.message as any)?.tool_calls;
            const id = result.id || `chatcmpl-${Date.now()}`;
            const model = result.model || request.model || "";
            const created = Math.floor(Date.now() / 1000);
            const stream = createPseudoStream(content, id, model, created, toolCalls);
            return new Response(stream as any, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, token, Authorization",
                },
            });
        }

        return result;
    },

    async completions(request): Promise<any> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        const req = CompletionRequest.self(request);
        const result = await AiService.completions(request, apiKey);

        if (request.stream) {
            const text = result.choices?.[0]?.text || "";
            const id = result.id || `cmpl-${Date.now()}`;
            const model = result.model || request.model || "";
            const created = Math.floor(Date.now() / 1000);
            const stream = createPseudoCompletionStream(text, id, model, created);
            return new Response(stream as any, {
                headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, token, Authorization",
                },
            });
        }

        return result;
    },

    async models(request): Promise<ModelsResponse> {
        ModelsRequest.self(request);
        const data = await AiService.listModels();
        return new ModelsResponse(data);
    },
});
