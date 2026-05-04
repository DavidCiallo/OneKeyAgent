import { config } from "dotenv";
config();
import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import { TaskEntity } from "../../../shared/modules/task/task.entity";

function isJSON(str: string) {
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
}

const waitDelMessage: Array<{
    chat_id: string;
    message_id: string;
}> = [];

const accountRepo = Repository.instance<AccountEntity>("Account");
const taskRepo = Repository.instance<TaskEntity>("Task");

export class TelegramService {

    static async handleMessage(chatId: string, text: string, messageId?: number): Promise<void> {
        // 先检查是否已绑定
        const account = await accountRepo.findOne({ tg_chat_id: chatId, delete_time: null });
        if (!account) {
            if (text.startsWith("/auth")) {
                return await this.handleAuthCommand(chatId, text);
            }
            await this.sendMessage(chatId, 'Please use <code>/auth &lt;apiKey&gt;</code> first');
            return;
        }

        if (text.startsWith("/")) {
            return await this.handleCommand(account, text, messageId);
        }
        return await this.handleTaskCreate(account, text);
    }

    static async handleAuthCommand(chatId: string, text: string): Promise<void> {
        const parts = text.trim().split(/\s+/);
        const apiKey = parts.slice(1).join(" ");
        if (!apiKey) {
            await this.sendMessage(chatId, 'Usage: <code>/auth &lt;apiKey&gt;</code>');
            return;
        }
        const account = await accountRepo.findOne({ apiKey });
        if (!account) {
            await this.sendMessage(chatId, "Authentication failed, invalid API Key");
            return;
        }

        await accountRepo.update({ id: account.id }, { tg_chat_id: chatId });
        await this.sendMessage(chatId, `Bound successfully!\nAccount: <code>${account.name}</code>\nYou can set a working directory and start publishing tasks`);
        return;
    }

    static async handleCommand(account: AccountEntity, text: string, messageId?: number): Promise<void> {
        const parts = text.trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1).join(" ");

        if (!account.tg_chat_id) {
            return;
        }
        switch (command) {
            case "/help": {
                await this.sendMessage(account.tg_chat_id, [
                    "Available commands:",
                    "<code>/status</code> - Show current account, folder and task status",
                    "<code>/ls</code> - List contents of the system target folder",
                    "<code>/help</code> - Show this help message",
                ].join("\n"));
                return;
            }
            case "/status": {
                const status = {
                    name: "",
                    folder: "",
                    currentTask: "",
                }
                const processTask = await taskRepo.findOne({ account_id: account.id, status: "processing" });
                if (processTask) {
                    status.currentTask = processTask.task_text.slice(0, 10);
                    status.folder = processTask.folder || "";
                } else {
                    const allTasks = await taskRepo.find({ account_id: account.id });
                    const latestTask = allTasks.sort((a, b) => b.create_time - a.create_time)[0];
                    if (latestTask) {
                        status.currentTask = latestTask.task_text.slice(0, 10);
                        status.folder = latestTask.folder || "";
                    }
                }
                let result = "";
                result += `Account: <code>${account.name}</code>\n`;
                result += `Folder: <code>${status.folder || "none"}</code>\n`;
                result += `Task: <code>${status.currentTask || "none"}</code>\n`;
                await this.sendMessage(account.tg_chat_id, result);
                return;
            }
            case "/ls": {
                const tasks = await taskRepo.find({ account_id: account.id });
                const latestTask = tasks.sort((a, b) => b.create_time - a.create_time)[0];
                await taskRepo.insert({
                    account_id: account.id,
                    task_text: `ls ${args}`,
                    status: "pending",
                    folder: latestTask?.folder || null,
                });
                return;
            }

            case "/fd": {
                if (!args) {
                    await this.sendMessage(
                        account.tg_chat_id,
                        'Usage: Please use <code>/ls</code> to set a directory'
                    );
                    return;
                }
                const task = await taskRepo.insert({
                    account_id: account.id,
                    task_text: `fd ${args}`,
                    folder: args,
                    status: "pending",
                });
                await this.sendMessage(account.tg_chat_id, `Switch directory task created\nID: <code>${task.id}</code>\nTarget: <code>${args}</code>`);
                return;
            }
            default:
                await this.sendMessage(account.tg_chat_id, `Unknown command: ${command}`);
                return;
        }
    }

    static async handleTaskCreate(account: AccountEntity, text: string): Promise<void> {
        const latestTask = await taskRepo.find({ account_id: account.id });
        latestTask.sort((a, b) => b.create_time - a.create_time);
        let folder: string | null = null;
        if (latestTask.length > 0) {
            folder = latestTask[0].folder || null;
        }
        if (!folder) {
            if (account.tg_chat_id) {
                await this.sendMessage(account.tg_chat_id, 'Please use <code>/ls</code> to set a directory');
                return;
            }
        }
        await taskRepo.insert({
            account_id: account.id,
            task_text: text,
            folder,
            status: "pending",
        });
        if (account.tg_chat_id) {
            await this.sendMessage(account.tg_chat_id, `Task received:\n <code>${text.slice(0, 10) + (text.length > 10 ? "..." : "")}</code>`);
        }
    }

    static async sendMessage(chat_id: string, text: string): Promise<string | null> {
        const baseUrl = process.env.TG_BOT_API_BASE_URL;
        if (!baseUrl) {
            console.error(new Date().toISOString(), "TG_BOT_API_BASE_URL not configured");
            return null;
        }
        const body: any = { chat_id, text, parse_mode: "HTML" };
        if (isJSON(text) && Array.isArray(JSON.parse(text))) {
            const json = JSON.parse(text);
            body.text = "<pre>Parsed</pre>";
            body.reply_markup = { inline_keyboard: json };
        }
        let message_id: string | null = null;
        for (let i = 0; i < 30; i++) {
            const result = await fetch(baseUrl + '/sendMessage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            message_id = (await result.json())?.result?.message_id || null;
            if (message_id) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        waitDelMessage.filter(item => item.chat_id === chat_id).forEach(item => {
            this.deleteMessage(chat_id, item.message_id);
        });
        if (isJSON(text) && message_id) {
            waitDelMessage.push({ chat_id, message_id });
        }
        return message_id;
    }

    static async deleteMessage(chat_id: string, message_id: string): Promise<void> {
        const baseUrl = process.env.TG_BOT_API_BASE_URL;
        if (!baseUrl) return;
        await fetch(baseUrl + '/deleteMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id, message_id }),
        });
    }
}