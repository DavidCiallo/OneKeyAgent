import { TaskPollRequest, TaskPollResponse, TaskReceiveRequest, TaskReceiveResponse, TaskCompleteRequest, TaskCompleteResponse, TaskSendMessageRequest, TaskSendMessageResponse } from "./task.interface";

export const taskRoutes = {
    base: "/api",
    prefix: "/task",
    poll:     { path: "/poll",     request: {} as TaskPollRequest,           response: {} as TaskPollResponse },
    receive:  { path: "/receive",  request: {} as TaskReceiveRequest,        response: {} as TaskReceiveResponse },
    complete: { path: "/complete", request: {} as TaskCompleteRequest,       response: {} as TaskCompleteResponse },
    message:  { path: "/message",  request: {} as TaskSendMessageRequest,    response: {} as TaskSendMessageResponse },
} as const;
