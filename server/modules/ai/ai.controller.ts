import {
    ModelsResponse,
} from "../../../shared/modules/ai/ai.interface";
import { AiRouterInstance } from "../../../shared/modules/ai/ai.router";
import { inject } from "../../lib/inject";
import { AiService } from "./ai.service";
import { validateApiKey, getAccountIdByApiKey } from "./ai.auth";
import { getIdentifyByVerify } from "../auth/auth.service";
import { AccountService } from "../account/account.service";

export const aiController = new AiRouterInstance(inject, {
    async chatcompletions(request): Promise<any> {
        const api_key = request.auth || "";
        const accountId = await getAccountIdByApiKey(api_key);
        if (!accountId) throw new Error("Invalid API Key");

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
        const api_key = request.auth || "";
        const accountId = await getAccountIdByApiKey(api_key);
        if (!accountId) throw new Error("Invalid API Key");

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

    async v1messages(request): Promise<any> {
        const api_key = request.auth || "";
        const accountId = await getAccountIdByApiKey(api_key);
        if (!accountId) throw new Error("Invalid API Key");

        if (request.stream) {
            try {
                const stream = await AiService.antMessagesStream(request, accountId);
                return new Response(stream as any, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        Connection: "keep-alive",
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type, token, Authorization, x-api-key",
                    },
                });
            } catch (e: any) {
                console.error("[v1messages] streaming error:", e);
                // Return SSE-formatted error so Claude Code doesn't get JSON parse error
                const errorStream = new ReadableStream({
                    start(controller) {
                        const errEvent = {
                            type: "error",
                            error: { type: "api_error", message: e.message || "Stream failed" },
                        };
                        controller.enqueue(new TextEncoder().encode(`event: error\ndata: ${JSON.stringify(errEvent)}\n\n`));
                        controller.enqueue(new TextEncoder().encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
                        controller.close();
                    },
                });
                return new Response(errorStream, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        Connection: "keep-alive",
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                        "Access-Control-Allow-Headers": "Content-Type, token, Authorization, x-api-key",
                    },
                });
            }
        }

        const result = await AiService.antMessages(request, accountId);
        return result;
    },
});
