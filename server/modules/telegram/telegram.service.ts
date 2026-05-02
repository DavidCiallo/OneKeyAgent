import { config } from "dotenv";
config();
import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import { TaskEntity } from "../../../shared/modules/task/task.entity";

const accountRepo = Repository.instance<AccountEntity>("Account");
const taskRepo = Repository.instance<TaskEntity>("Task");

export class TelegramService {

    static async handleMessage(chatId: string, text: string): Promise<void> {
        // 先检查是否已绑定
        const account = await accountRepo.findOne({ tg_chat_id: chatId, delete_time: null });
        if (!account) {
            if (text.startsWith("/auth")) {
                return await this.handleAuthCommand(chatId, text);
            }
            return await this.sendMessage(chatId, "请先使用 /auth <apiKey>");
        }

        if (text.startsWith("/")) {
            return await this.handleCommand(account, text);
        }
        return await this.handleTaskCreate(account, text);
    }

    static async handleAuthCommand(chatId: string, text: string): Promise<void> {
        const parts = text.trim().split(/\s+/);
        const apiKey = parts.slice(1).join(" ");
        if (!apiKey) {
            return await this.sendMessage(chatId, "用法: /auth <apiKey>");
        }
        const account = await accountRepo.findOne({ apiKey });
        if (!account) {
            return await this.sendMessage(chatId, "认证失败，API Key 无效");
        }

        // 如果该账号之前绑定了其他 chat_id，更新
        await accountRepo.update({ id: account.id }, { tg_chat_id: chatId });
        return await this.sendMessage(chatId, `绑定成功！\n账号: ${account.name}\n你可以在指定工作目录后开始发布任务了`);
    }

    static async handleCommand(account: AccountEntity, text: string): Promise<void> {
        const parts = text.trim().split(/\s+/);
        const command = parts[0].toLowerCase();
        const args = parts.slice(1).join(" ");

        if (!account.tg_chat_id) {
            return;
        }
        switch (command) {
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
                }
                let result = "";
                result += `账号: ${account.name}\n`;
                result += `当前目录: ${status.folder || "无"}\n`;
                result += `当前任务: ${status.currentTask || "无"}\n`;
                // return result;
                return await this.sendMessage(account.tg_chat_id, result);
            }
            case "/ls": {
                await taskRepo.insert({
                    account_id: account.id,
                    task_text: "ls",
                    status: "pending",
                });
                return await this.sendMessage(account.tg_chat_id, `已创建目录列表任务！客户端将会列出系统目标文件夹下的内容`);
            }

            case "/fd": {
                if (!args) {
                    return await this.sendMessage(
                        account.tg_chat_id,
                        "用法: /fd <目录名>\n请指定要切换到的目录。可以先用 /ls 查看可用目录"
                    );
                }
                const task = await taskRepo.insert({
                    account_id: account.id,
                    task_text: `fd ${args}`,
                    folder: args,
                    status: "pending",
                });
                return await this.sendMessage(account.tg_chat_id, `已创建切换目录任务\nID: ${task.id}\n目标目录: ${args}`);
            }

            default:
                return await this.sendMessage(account.tg_chat_id, `未知命令: ${command}`);
        }
    }

    static async handleTaskCreate(account: AccountEntity, text: string): Promise<void> {
        const latestTask = await taskRepo.find({ account_id: account.id });
        latestTask.sort((a, b) => b.create_time - a.create_time);
        console.log(latestTask);
        let folder: string | null = null;
        if (latestTask.length > 0) {
            folder = latestTask[0].folder || null;
        }
        if (!folder) {
            if (account.tg_chat_id) {
                return await this.sendMessage(account.tg_chat_id, `请先使用/fd <目录名> 以指定目录`);
            }
        }
        await taskRepo.insert({
            account_id: account.id,
            task_text: text,
            folder,
            status: "pending",
        });
        if (account.tg_chat_id) {
            await this.sendMessage(account.tg_chat_id, `已接受会话内容:\n ${text.slice(0, 10) + (text.length > 10 ? "..." : "")}`);
        }
    }

    static async sendMessage(chat_id: string, text: string): Promise<void> {
        const baseUrl = process.env.TG_BOT_API_BASE_URL;
        if (!baseUrl) {
            console.error("TG_BOT_API_BASE_URL 未配置");
            return;
        }
        await fetch(baseUrl + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id, text }),
        });
    }
}