import { TelegramService } from "./telegram.service";

/**
 * 处理 TG webhook 请求
 * TG POST 过来的格式: { message: { chat: { id: number }, text: string } }
 * 或 { callback_query: { message: { chat: { id: number } }, data: string } }
 */
export async function handleTelegramWebhook(req: Request): Promise<Response> {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return new Response("Bad Request", { status: 400 });
    }

    const callbackQuery = body.callback_query;
    if (callbackQuery) {
        const chatId = String(callbackQuery.message.chat.id);
        const data = callbackQuery.data;
        TelegramService.handleMessage(chatId, data);
        // 回复 callback_query 来消除 loading 状态，不额外发消息
        await fetch(`${process.env.TG_BOT_API_BASE_URL}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: callbackQuery.id }),
        });
        return new Response("OK");
    }

    // 提取消息内容
    const message = body.message || body.edited_message;
    if (!message || !message.text) {
        // TG 的 non-text 消息（图片、贴纸等），忽略
        return new Response("OK");
    }

    const chatId = String(message.chat.id);
    const text = message.text;
    const messageId = message.message_id;
    TelegramService.handleMessage(chatId, text, messageId);
    return new Response("OK");
}
