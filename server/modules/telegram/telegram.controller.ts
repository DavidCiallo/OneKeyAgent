import {
    TelegramWebhookRequest,
} from "../../../shared/modules/telegram/telegram.interface";
import { telegramRoutes } from "../../../shared/modules/telegram/telegram.router";
import { TelegramService } from "./telegram.service";
import { SettingsService } from "../settings/settings.service";

async function webhook(request: TelegramWebhookRequest) {
    request = TelegramWebhookRequest.self(request);
    const body = request.raw;
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
        return {};
    }

    const message = body.message || body.edited_message;
    if (!message || !message.text) return {};

    const chatId = String(message.chat.id);
    const text = message.text;
    const messageId = message.message_id;
    TelegramService.handleMessage(chatId, text, messageId);
    return {};
}

export const telegramMount = {
    routes: telegramRoutes,
    handlers: { webhook },
};
