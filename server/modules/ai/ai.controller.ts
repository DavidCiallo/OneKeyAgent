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

export const aiController = new AiRouterInstance(inject, {
    async chatcompletions(request): Promise<any> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        const req = ChatCompletionsRequest.self(request);

        if (request.stream) {
            // 真流式：直接原封不动转发 upstream 的 SSE chunk
            const stream = await AiService.chatCompletionsStream(request, apiKey);
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

        const result = await AiService.chatCompletions(request, apiKey);
        return result;
    },

    async completions(request): Promise<any> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        const req = CompletionRequest.self(request);

        if (request.stream) {
            // 真流式：直接原封不动转发 upstream 的 SSE chunk
            const stream = await AiService.completionsStream(request, apiKey);
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

        const result = await AiService.completions(request, apiKey);
        return result;
    },

    async models(request): Promise<ModelsResponse> {
        ModelsRequest.self(request);
        const data = await AiService.listModels();
        return new ModelsResponse(data);
    },
});
