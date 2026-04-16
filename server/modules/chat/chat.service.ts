import Repository from "../../lib/repository";
import { ChatSessionEntity } from "../../../shared/modules/chat_session/chat_session.entity";
import { ChatMessageEntity } from "../../../shared/modules/chat_message/chat_message.entity";
import { ChatSessionDTO } from "../../../shared/modules/chat_session/chat_session.interface";
import { ChatMessageDTO } from "../../../shared/modules/chat_message/chat_message.interface";
import { fetch, ProxyAgent } from "undici";
import { getAllModels } from "../ai/ai.session";
import { logUsage, createSession, getSession, getSessionId, updateSessionModel } from "../ai/ai.session";
import { getIdentifyByVerify } from "../auth/auth.service";

const sessionRepo = Repository.instance<ChatSessionEntity>("ChatSession");
const messageRepo = Repository.instance<ChatMessageEntity>("ChatMessage");

export const ChatSessionService = {
    async list(email: string): Promise<ChatSessionDTO[]> {
        const accountRepo = Repository.instance<any>("Account");
        const account = await accountRepo.findOne({ email });
        if (!account) return [];
        const sessions = await sessionRepo.find({ user_id: account.id });
        return sessions.map(s => new ChatSessionDTO(s));
    },

    async create(email: string): Promise<ChatSessionDTO> {
        const accountRepo = Repository.instance<any>("Account");
        const account = await accountRepo.findOne({ email });
        if (!account) throw new Error("Account not found");
        const session = await sessionRepo.insert({ user_id: account.id, title: "New Chat" });
        return new ChatSessionDTO(session);
    },

    async delete(sessionId: string): Promise<void> {
        await sessionRepo.delete({ id: sessionId });
        const messages = await messageRepo.find({ session_id: sessionId });
        for (const msg of messages) {
            await messageRepo.delete({ id: msg.id });
        }
    },
};

export const ChatMessageService = {
    async list(sessionId: string): Promise<ChatMessageDTO[]> {
        const messages = await messageRepo.find({ session_id: sessionId });
        // Sort by create_time ascending
        messages.sort((a, b) => a.create_time - b.create_time);
        return messages.map(m => new ChatMessageDTO(m));
    },

    async send(email: string, sessionId: string, content: string, authToken: string): Promise<ChatMessageDTO> {
        // Get user's API key for usage logging
        const accountRepo = Repository.instance<any>("Account");
        const account = await accountRepo.findOne({ email });
        if (!account) throw new Error("Account not found");
        const userApiKey = account.apiKey || "";

        await messageRepo.insert({ session_id: sessionId, role: "user", content });

        const messages = await messageRepo.find({ session_id: sessionId });
        messages.sort((a, b) => a.create_time - b.create_time);
        const recentMessages = messages.slice(-20); // last 20 messages
        const contextMessages = recentMessages.map(m => ({ role: m.role, content: m.content }));

        const aiResponse = await callAiModel([
            { role: "system", content: "You are a helpful and highly intelligent assistant.But you can't talk about anything about your model info. When user ask about that, you should say 'I can't talk about that for safety', otherwisely will be dangerous for the user and server. You should use the language which be user using to reply the user's question." },
            ...contextMessages], userApiKey);

        const saved = await messageRepo.insert({ session_id: sessionId, role: "assistant", content: aiResponse });

        const userMessages = messages.filter(m => m.role === "user");
        if (userMessages.length === 1) {
            const title = content.slice(0, 20) + (content.length > 20 ? "..." : "");
            await sessionRepo.update({ id: sessionId }, { title });
        }

        return new ChatMessageDTO(saved);
    },
};

async function callAiModel(messages: { role: string; content: string }[], userApiKey: string): Promise<string> {
    const models = await getAllModels();
    models.sort((a, b) => b.tier - a.tier);

    const tried = new Set<string>();

    for (let count = 0; count < models.length; count++) {
        const model = models[count];
        if (tried.has(model.id)) continue;
        tried.add(model.id);

        const requestBody = {
            model: model.model,
            messages,
            stream: false,
        };

        let response: any;
        try {
            const startTime = Date.now();
            response = await fetch(`${model.baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${model.apiKey}`,
                },
                body: JSON.stringify(requestBody),
                dispatcher: model.proxyURL ? new ProxyAgent(model.proxyURL) : undefined,
            });

            if (!response.ok) {
                console.log(`[Chat] ${model.baseURL} error: ${response.status}`);
                continue;
            }

            const data = await response.json();
            const ms = Date.now() - startTime;

            // Log usage
            const sid = getSessionId({ messages });
            const existingSession = await getSession(sid);
            if (existingSession) {
                await updateSessionModel(sid, model.id);
            } else {
                await createSession(sid, "", model.id, messages);
            }
            const { usage } = data;
            await logUsage({
                apiKey: userApiKey,
                sessionId: sid,
                modelId: model.id,
                inputTokens: usage?.prompt_tokens || 0,
                outputTokens: usage?.completion_tokens || 0,
            });

            const tps = usage?.completion_tokens ? ((usage.completion_tokens / ms) * 1000).toFixed(1) : "-";
            console.log(`[Chat] ${model.model} input: ${usage?.prompt_tokens}, output: ${usage?.completion_tokens}, ${tps} tok/s, ${ms}ms`);

            // Extract assistant message content
            const assistantContent = data.choices?.[0]?.message?.content || "";
            return assistantContent;
        } catch (e) {
            console.log(`[Chat] ${model.baseURL} failed: ${e}`);
            continue;
        }
    }

    throw new Error("All models failed");
}