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
        const account_id = await getAccountIdByApiKey(api_key);
        if (!account_id) throw new Error("Invalid API Key");

        if (request.stream) {
            const stream = await AiService.chatCompletionsStream(request, account_id);
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

        const result = await AiService.chatCompletions(request, account_id);
        return result;
    },

    async completions(request): Promise<any> {
        const api_key = request.auth || "";
        const account_id = await getAccountIdByApiKey(api_key);
        if (!account_id) throw new Error("Invalid API Key");

        if (request.stream) {
            const stream = await AiService.completionsStream(request, account_id);
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

        const result = await AiService.completions(request, account_id);
        return result;
    },

    async models(request): Promise<ModelsResponse> {
        const auth = request.auth || "";
        let account_id = "";

        if (auth) {
            // Try API key auth first
            if (validateApiKey(auth)) {
                account_id = (await getAccountIdByApiKey(auth)) || "";
            } else {
                // Try JWT token auth (used by frontend ProfilePage)
                const email = getIdentifyByVerify(auth);
                if (email) {
                    const account = await AccountService.findByEmail(email);
                    if (account) account_id = account.id;
                }
            }
        }

        const data = await AiService.listModels(account_id);
        return new ModelsResponse(data);
    },

    async v1messages(request): Promise<any> {
        const api_key = request.auth || "";
        const account_id = await getAccountIdByApiKey(api_key);
        if (!account_id) throw new Error("Invalid API Key");

        if (request.stream) {
            try {
                const stream = await AiService.antMessagesStream(request, account_id);
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

        const result = await AiService.antMessages(request, account_id);
        return result;
    },
});
