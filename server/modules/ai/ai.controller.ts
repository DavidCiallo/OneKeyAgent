import {
    ModelsResponse,
} from "../../../shared/modules/ai/ai.interface";
import { aiRoutes } from "../../../shared/modules/ai/ai.router";
import { AiService } from "./ai.service";
import { validateApiKey, getAccountIdByApiKey } from "./ai.auth";
import { getIdentifyByVerify } from "../auth/auth.service";
import { AccountService } from "../account/account.service";

async function chatcompletions(request: any) {
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

    return AiService.chatCompletions(request, account_id);
}

async function completions(request: any) {
    const api_key = request.auth || "";
    const account_id = await getAccountIdByApiKey(api_key);
    if (!account_id) throw new Error("Invalid API Key");

    if (request.stream) {
        const stream = await AiService.completionsStream(request, account_id);
        return new Response(stream as any, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, token, Authorization",
            },
        });
    }

    return AiService.completions(request, account_id);
}

async function models(request: any): Promise<ModelsResponse> {
    const auth = request.auth || "";
    let account_id = "";

    if (auth) {
        if (validateApiKey(auth)) {
            account_id = (await getAccountIdByApiKey(auth)) || "";
        } else {
            const email = getIdentifyByVerify(auth);
            if (email) {
                const account = await AccountService.findByEmail(email);
                if (account) account_id = account.id;
            }
        }
    }

    const data = await AiService.listModels(account_id);
    return new ModelsResponse(data);
}

async function v1messages(request: any) {
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

    return AiService.antMessages(request, account_id);
}

export const aiMount = {
    routes: aiRoutes,
    handlers: { chatcompletions, completions, models, v1messages },
};
