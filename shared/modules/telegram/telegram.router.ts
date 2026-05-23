import { TelegramWebhookRequest, TelegramWebhookResponse } from "./telegram.interface";

export const telegramRoutes = {
    base: "/api",
    prefix: "/tg",
    webhook: { path: "/webhook", request: {} as TelegramWebhookRequest, response: {} as TelegramWebhookResponse },
} as const;
