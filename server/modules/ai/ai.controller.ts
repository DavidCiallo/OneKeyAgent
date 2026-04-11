import {
    ChatCompletionsRequest,
    CompletionRequest,
    ModelsRequest,
    ModelsResponse,
} from "../../../shared/modules/ai/ai.interface";
import { AiRouterInstance } from "../../../shared/modules/ai/ai.router";
import { inject } from "../../lib/inject";
import { AiService } from "./ai.service";

export const aiController = new AiRouterInstance(inject, {
    async chatcompletions(request): Promise<any> {
        const req = ChatCompletionsRequest.self(request);
        return await AiService.chatCompletions(request);
    },

    async completions(request): Promise<any> {
        const req = CompletionRequest.self(request);
        return await AiService.completions(request);
    },

    async models(request): Promise<ModelsResponse> {
        ModelsRequest.self(request);
        const data = await AiService.listModels();
        return new ModelsResponse(data);
    },
});
