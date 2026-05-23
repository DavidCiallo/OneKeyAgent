import {
    TaskDTO,
    TaskPollRequest,
    TaskReceiveRequest,
    TaskCompleteRequest,
    TaskSendMessageRequest,
} from "../../../shared/modules/task/task.interface";
import { taskRoutes } from "../../../shared/modules/task/task.router"
import { TaskService } from "./task.service";
import { getAccountIdByApiKey } from "../ai/ai.auth";
import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";

const accountRepo = Repository.instance<AccountEntity>("Account");

async function poll(request: TaskPollRequest) {
    request = TaskPollRequest.self(request);
    const account_id = await getAccountIdByApiKey(request.auth || "");
    if (!account_id) throw "Authorization failed";

    const task = await TaskService.pollByAccount(account_id);
    if (!task) return { task: null };
    return { task: new TaskDTO(task) };
}

async function receive(request: TaskReceiveRequest) {
    request = TaskReceiveRequest.self(request);

    const account = await accountRepo.findOne({ tg_chat_id: request.task.tg_chat_id } as any);
    if (!account) throw "no account bound to this tg_chat_id";

    const data = await TaskService.create({
        account_id: account.id,
        task_text: request.task.text,
    });

    const task = new TaskDTO(data);
    return { task };
}

async function complete(request: TaskCompleteRequest) {
    request = TaskCompleteRequest.self(request);
    const data = await TaskService.complete(request.id, request.task.status, request.task.result);
    if (!data) throw "task not found";
    const task = new TaskDTO(data);
    return { task };
}

async function message(request: TaskSendMessageRequest) {
    request = TaskSendMessageRequest.self(request);
    const ok = await TaskService.sendMessageByTaskId(request.id, request.text);
    if (!ok) throw "task not found or no tg bound";
    return {};
}

export const taskMount = {
    routes: taskRoutes,
    handlers: { poll, receive, complete, message },
};
