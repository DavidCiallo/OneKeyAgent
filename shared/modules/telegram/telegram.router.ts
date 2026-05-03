import { BaseRouterInstance } from "../../lib/default/decorator";
import { TelegramWebhookRequest, TelegramWebhookResponse } from "./telegram.interface";

export class TelegramRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/tg";
    router = [
        { path: "/webhook", handler: Function },
    ];

    webhook!: (body: TelegramWebhookRequest) => Promise<TelegramWebhookResponse>;

    constructor(inject: Function, functions?: {
        webhook: (body: TelegramWebhookRequest) => Promise<TelegramWebhookResponse>,
    }) {
        super();
        inject(this, functions);
    }
}
