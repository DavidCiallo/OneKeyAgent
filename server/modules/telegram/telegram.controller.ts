import {
    TelegramWebhookRequest,
    TelegramWebhookResponse,
} from "../../../shared/modules/telegram/telegram.interface";
import { TelegramRouterInstance } from "../../../shared/modules/telegram/telegram.router";
import { inject } from "../../lib/inject";
import { TelegramService } from "./telegram.service";
import { SettingsService } from "../settings/settings.service";

async function webhook(request: TelegramWebhookRequest): Promise<TelegramWebhookResponse> {
    request = TelegramWebhookRequest.self(request);
    const body = request.raw; // raw TG body passed through mount.ts

    const callbackQuery = body.callback_query;
    if (callbackQuery) {
        const chatId = String(callbackQuery.message.chat.id);
        const data = callbackQuery.data;
        TelegramService.handleMessage(chatId, data);
        await fetch(`${SettingsService.get("tg_bot_api_base_url")}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: callbackQuery.id }),
        });
        return new TelegramWebhookResponse({ success: true, message: "OK" });
    }

    const message = body.message || body.edited_message;
    if (!message || !message.text) {
        return new TelegramWebhookResponse({ success: true, message: "OK" });
    }

    const chatId = String(message.chat.id);
    const text = message.text;
    const messageId = message.message_id;
    TelegramService.handleMessage(chatId, text, messageId);
    return new TelegramWebhookResponse({ success: true, message: "OK" });
}

export const telegramController = new TelegramRouterInstance(inject, { webhook });
