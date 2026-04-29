import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    TaskCreateRequest, TaskCreateResponse,
    TaskPollRequest, TaskPollResponse,
    TaskUpdateRequest, TaskUpdateResponse,
} from "./mcp.interface";

export class McpRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/mcp";
    router = [
        { path: "/create", handler: Function },
        { path: "/poll", handler: Function },
        { path: "/update", handler: Function },
    ];

    create!: (body: TaskCreateRequest) => Promise<TaskCreateResponse>;
    poll!: (query: TaskPollRequest) => Promise<TaskPollResponse>;
    update!: (body: TaskUpdateRequest) => Promise<TaskUpdateResponse>;

    constructor(inject: Function, functions?: {
        create: (body: TaskCreateRequest) => Promise<TaskCreateResponse>,
        poll: (query: TaskPollRequest) => Promise<TaskPollResponse>,
        update: (body: TaskUpdateRequest) => Promise<TaskUpdateResponse>,
    }) {
        super();
        inject(this, functions);
    }
}