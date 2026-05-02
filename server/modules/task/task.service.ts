import Repository from "../../lib/repository";
import { TaskEntity } from "../../../shared/modules/task/task.entity";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import { TelegramService } from "../telegram/telegram.service";

const taskRepository: Repository<TaskEntity> = Repository.instance("Task");
const accountRepository: Repository<AccountEntity> = Repository.instance("Account");

export class TaskService {
    // Long polling design for rolling task
    static async pollByAccount(accountId: string): Promise<TaskEntity | null> {
        const existProcessing = await taskRepository.findOne({ account_id: accountId, status: "processing" });
        if (existProcessing) {
            await new Promise(resolve => setTimeout(resolve, 15 * 1000));
            return existProcessing;
        }
        let count = 0;
        while (count++ < 50) {
            const task = await taskRepository.findOne({ account_id: accountId, status: "pending" });
            if (!task) {
                await new Promise(resolve => setTimeout(resolve, 1 * 1000));
                continue;
            }
            await taskRepository.update({ id: task.id }, { status: "processing" });
            return { ...task, status: "processing" };
        }
        return null;
    }

    static async create(data: Partial<TaskEntity>): Promise<TaskEntity> {
        return await taskRepository.insert(data);
    }

    static async complete(id: string, status: string, result?: string): Promise<TaskEntity | null> {
        const targetTask = await taskRepository.findOne({ id });
        if (!targetTask) return null;
        const account = await accountRepository.findOne({ id: targetTask.account_id });
        if (account?.tg_chat_id) {
            await TelegramService.sendMessage(account.tg_chat_id, result || "No reply and ask again maybe...");
        }
        const updateData = { status };
        await taskRepository.update({ id }, updateData);
        return await taskRepository.findOne({ id });
    }
}
