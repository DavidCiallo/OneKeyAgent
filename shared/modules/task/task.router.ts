import { BaseRouterInstance } from "../../lib/default/decorator";
import { TaskPollRequest, TaskPollResponse, TaskReceiveRequest, TaskReceiveResponse, TaskCompleteRequest, TaskCompleteResponse } from "./task.interface";

export class TaskRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/task";
    router = [
        { path: "/poll", handler: Function },
        { path: "/receive", handler: Function },
        { path: "/complete", handler: Function },
    ];

    poll!: (query: TaskPollRequest) => Promise<TaskPollResponse>;
    receive!: (body: TaskReceiveRequest) => Promise<TaskReceiveResponse>;
    complete!: (body: TaskCompleteRequest) => Promise<TaskCompleteResponse>;

    constructor(inject: Function, functions?: {
        poll: (query: TaskPollRequest) => Promise<TaskPollResponse>,
        receive: (body: TaskReceiveRequest) => Promise<TaskReceiveResponse>,
        complete: (body: TaskCompleteRequest) => Promise<TaskCompleteResponse>,
    }) {
        super();
        inject(this, functions);
    }
}
