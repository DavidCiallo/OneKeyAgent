import { BaseRouterInstance } from "../../lib/default/decorator";
import { TaskPollRequest, TaskPollResponse, TaskReceiveRequest, TaskReceiveResponse, TaskCompleteRequest, TaskCompleteResponse, TaskSendMessageRequest, TaskSendMessageResponse } from "./task.interface";

export class TaskRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/task";
    router = [
        { path: "/poll", handler: Function },
        { path: "/receive", handler: Function },
        { path: "/complete", handler: Function },
        { path: "/message", handler: Function },
    ];

    poll!: (query: TaskPollRequest) => Promise<TaskPollResponse>;
    receive!: (body: TaskReceiveRequest) => Promise<TaskReceiveResponse>;
    complete!: (body: TaskCompleteRequest) => Promise<TaskCompleteResponse>;
    message!: (body: TaskSendMessageRequest) => Promise<TaskSendMessageResponse>;

    constructor(inject: Function, functions?: {
        poll: (query: TaskPollRequest) => Promise<TaskPollResponse>,
        receive: (body: TaskReceiveRequest) => Promise<TaskReceiveResponse>,
        complete: (body: TaskCompleteRequest) => Promise<TaskCompleteResponse>,
        message: (body: TaskSendMessageRequest) => Promise<TaskSendMessageResponse>,
    }) {
        super();
        inject(this, functions);
    }
}
