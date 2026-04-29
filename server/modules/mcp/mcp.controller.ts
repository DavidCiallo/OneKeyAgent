import { TaskEntity, TaskDTO } from "../../../shared/modules/mcp/mcp.entity";
import {
    TaskCreateRequest, TaskCreateResponse,
    TaskPollRequest, TaskPollResponse,
    TaskUpdateRequest, TaskUpdateResponse,
} from "../../../shared/modules/mcp/mcp.interface";
import { McpRouterInstance } from "../../../shared/modules/mcp/mcp.router";
import { inject } from "../../lib/inject";
import { McpService } from "./mcp.service";

async function create(request: TaskCreateRequest): Promise<TaskCreateResponse> {
    request = TaskCreateRequest.self(request);

    const data = await McpService.create({
        task: request.task.task,
        folder: request.task.folder,
        user: request.task.user,
        status: "pending",
    });
    if (!data) throw "create failed";
    const task = new TaskDTO(data);
    return new TaskCreateResponse({
        success: true,
        data: { task },
        message: "success"
    });
}

async function poll(request: TaskPollRequest): Promise<TaskPollResponse> {
    TaskPollRequest.self(request);

    const data = await McpService.getNextPending();
    const task = data ? new TaskDTO(data) : null;
    return new TaskPollResponse({
        success: true,
        data: { task },
        message: task ? "task found" : "no pending task"
    });
}

async function update(request: TaskUpdateRequest): Promise<TaskUpdateResponse> {
    request = TaskUpdateRequest.self(request);

    const updateData: Partial<TaskEntity> = {};
    if (request.task.status) updateData.status = request.task.status;
    if (request.task.summary !== undefined) updateData.summary = request.task.summary;

    const data = await McpService.update(request.id, updateData);
    if (!data) throw "update failed";
    const task = new TaskDTO(data);
    return new TaskUpdateResponse({
        success: true,
        data: { task },
        message: "success"
    });
}

export const mcpController = new McpRouterInstance(inject, { create, poll, update });