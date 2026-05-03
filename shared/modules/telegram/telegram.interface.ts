import { BaseRequest, BaseResponse } from "../../lib/default/decorator";

/** TG webhook request body (pass-through — Telegram owns the format) */
export class TelegramWebhookRequest implements BaseRequest {
    public auth?: string;
    public raw: Record<string, any>;

    constructor(origin: Partial<TelegramWebhookRequest> & Record<string, any>) {
        this.auth = origin.auth;
        this.raw = origin;
    }
    static self(unsafe: TelegramWebhookRequest) {
        return new TelegramWebhookRequest(unsafe);
    }
}

export class TelegramWebhookResponse implements BaseResponse<null> {
    public success: boolean;
    public message: string;

    constructor(origin: TelegramWebhookResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}
