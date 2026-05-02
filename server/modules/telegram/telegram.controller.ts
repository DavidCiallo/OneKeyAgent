import { TelegramService } from "./telegram.service";

/**
 * 处理 TG webhook 请求
 * TG POST 过来的格式: { message: { chat: { id: number }, text: string } }
 */
export async function handleTelegramWebhook(req: Request): Promise<Response> {
    let body: any;
    try {
        body = await req.json();
    } catch {
        return new Response("Bad Request", { status: 400 });
    }

    // 提取消息内容
    const message = body.message || body.edited_message;
    if (!message || !message.text) {
        // TG 的 non-text 消息（图片、贴纸等），忽略
        return new Response("OK");
    }

    const chatId = String(message.chat.id);
    const text = message.text;
    TelegramService.handleMessage(chatId, text);
    return new Response("OK");
}
