import {
    ChatCompletionsRequest,
    CompletionRequest,
    ModelsRequest,
    ModelsResponse,
} from "../../../shared/modules/ai/ai.interface";
import { AiRouterInstance } from "../../../shared/modules/ai/ai.router";
import { inject } from "../../lib/inject";
import { AiService } from "./ai.service";
import { validateApiKey, verifyApiKeyInDb, getAccountIdByApiKey } from "./ai.auth";
import { getIdentifyByVerify } from "../auth/auth.service";
import { AccountService } from "../account/account.service";

export const aiController = new AiRouterInstance(inject, {
    async chatcompletions(request): Promise<any> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        const accountId = await getAccountIdByApiKey(apiKey);
        if (!accountId) throw new Error("Invalid API Key");
        const req = ChatCompletionsRequest.self(request);

        if (request.stream) {
            const stream = await AiService.chatCompletionsStream(request, accountId);
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

        const result = await AiService.chatCompletions(request, accountId);
        return result;
    },

    async completions(request): Promise<any> {
        const apiKey = request.auth || "";
        if (!validateApiKey(apiKey) || !(await verifyApiKeyInDb(apiKey))) {
            throw new Error("Invalid API Key");
        }
        const accountId = await getAccountIdByApiKey(apiKey);
        if (!accountId) throw new Error("Invalid API Key");
        const req = CompletionRequest.self(request);

        if (request.stream) {
            const stream = await AiService.completionsStream(request, accountId);
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

        const result = await AiService.completions(request, accountId);
        return result;
    },

    async models(request): Promise<ModelsResponse> {
        const auth = request.auth || "";
        let accountId = "";

        if (auth) {
            // Try API key auth first
            if (validateApiKey(auth)) {
                accountId = (await getAccountIdByApiKey(auth)) || "";
            } else {
                // Try JWT token auth (used by frontend ProfilePage)
                const email = getIdentifyByVerify(auth);
                if (email) {
                    const account = await AccountService.findByEmail(email);
                    if (account) accountId = account.id;
                }
            }
        }

        const data = await AiService.listModels(accountId);
        return new ModelsResponse(data);
    },
});
