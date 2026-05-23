import {
    TaskDTO,
    TaskPollRequest,
    TaskPollResponse,
    TaskReceiveRequest,
    TaskReceiveResponse,
    TaskCompleteRequest,
    TaskCompleteResponse,
    TaskSendMessageRequest,
    TaskSendMessageResponse,
} from "../../../shared/modules/task/task.interface";
import { TaskRouterInstance } from "../../../shared/modules/task/task.router"
import { inject } from "../../lib/inject";
import { TaskService } from "./task.service";
import { getAccountIdByApiKey } from "../ai/ai.auth";
import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";

const accountRepo = Repository.instance<AccountEntity>("Account");

async function poll(request: TaskPollRequest): Promise<TaskPollResponse> {
    request = TaskPollRequest.self(request);
    const account_id = await getAccountIdByApiKey(request.auth || "");
    if (!account_id) throw "Authorization failed";

    const task = await TaskService.pollByAccount(account_id);
    if (!task) {
        return new TaskPollResponse({
            success: true,
            data: { task: null },
            message: "no pending task",
        });
    }
    return new TaskPollResponse({
        success: true,
        data: { task: new TaskDTO(task) },
        message: "success",
    });
}

async function receive(request: TaskReceiveRequest): Promise<TaskReceiveResponse> {
    request = TaskReceiveRequest.self(request);

    // 通过 tg_chat_id 找到绑定的账号
    const account = await accountRepo.findOne({ tg_chat_id: request.task.tg_chat_id } as any);
    if (!account) {
        throw "no account bound to this tg_chat_id";
    }

    const data = await TaskService.create({
        account_id: account.id,
        task_text: request.task.text,
    });

    const task = new TaskDTO(data);
    return new TaskReceiveResponse({
        success: true,
        data: { task },
        message: "success",
    });
}

async function complete(request: TaskCompleteRequest): Promise<TaskCompleteResponse> {
    request = TaskCompleteRequest.self(request);
    const data = await TaskService.complete(request.id, request.task.status, request.task.result);
    if (!data) throw "task not found";
    const task = new TaskDTO(data);
    return new TaskCompleteResponse({
        success: true,
        data: { task },
        message: "success",
    });
}

async function message(request: TaskSendMessageRequest): Promise<TaskSendMessageResponse> {
    request = TaskSendMessageRequest.self(request);
    const ok = await TaskService.sendMessageByTaskId(request.id, request.text);
    if (!ok) throw "task not found or no tg bound";
    return new TaskSendMessageResponse({
        success: true,
        message: "success",
    });
}

export const taskController = new TaskRouterInstance(inject, { poll, receive, complete, message });
