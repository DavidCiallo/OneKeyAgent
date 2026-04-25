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

export const aiOllamaController = new AiOllamaRouterInstance(inject, {
    async chat(request): Promise<OllamaChatResponse> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        OllamaChatRequest.self(request);

        const result = await AiService.chatCompletions(request, apiKey);
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

    async generate(request): Promise<OllamaGenerateResponse> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        OllamaGenerateRequest.self(request);

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
        return new OllamaTagsResponse(data);
    },
});
