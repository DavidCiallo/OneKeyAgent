import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { TaskEntity } from "./task.entity";

// DTO
export class TaskDTO {
    public id: string;
    public account_id: string;
    public task_text: string;
    public folder: string | null;
    public status: string;
    public create_time: number;

    constructor(origin: TaskEntity) {
        this.id = origin.id;
        this.account_id = origin.account_id;
        this.task_text = origin.task_text;
        this.folder = origin.folder;
        this.status = origin.status;
        this.create_time = origin.create_time;
    }
}

// Poll: Client fetches its pending tasks (authenticated via api_key)
export class TaskPollRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<TaskPollRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: TaskPollRequest) {
        return new TaskPollRequest(unsafe);
    }
}

export class TaskPollResponse implements BaseResponse<TaskDTO> {
    public success: boolean;
    public message: string;
    public data: {
        task: TaskDTO | null
    };

    constructor(origin: TaskPollResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// Receive: TG pushes a message, server receives and parses it to create a task
export class TaskReceiveBody {
    public tg_chat_id: string;
    public text: string;

    constructor(origin: { tg_chat_id: string; text: string }) {
        if (!origin.tg_chat_id || !origin.text) {
            throw new Error("tg_chat_id and text are required");
        }
        this.tg_chat_id = origin.tg_chat_id;
        this.text = origin.text;
    }

    static self(unsafe: TaskReceiveBody) {
        return new TaskReceiveBody(unsafe);
    }
}

export class TaskReceiveRequest implements BaseRequest {
    public auth?: string;
    public task: TaskReceiveBody;

    constructor(origin: Partial<TaskReceiveRequest>) {
        if (!origin.task) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.task = TaskReceiveBody.self(origin.task);
    }
    static self(unsafe: TaskReceiveRequest) {
        return new TaskReceiveRequest(unsafe);
    }
}

export class TaskReceiveResponse implements BaseResponse<TaskDTO> {
    public success: boolean;
    public message: string;
    public data: {
        task: TaskDTO | null
    };

    constructor(origin: TaskReceiveResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// Complete: Client updates task status after completion, optionally returns result text
export class TaskCompleteBody {
    public status: "completed" | "failed";
    public result?: string;

    constructor(origin: { status: "completed" | "failed"; result?: string }) {
        if (!origin.status) {
            throw new Error("status is required");
        }
        this.status = origin.status;
        this.result = origin.result;
    }

    static self(unsafe: TaskCompleteBody) {
        return new TaskCompleteBody(unsafe);
    }
}

export class TaskCompleteRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public task: TaskCompleteBody;

    constructor(origin: Partial<TaskCompleteRequest>) {
        if (!origin.id || !origin.task) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.task = TaskCompleteBody.self(origin.task);
    }
    static self(unsafe: TaskCompleteRequest) {
        return new TaskCompleteRequest(unsafe);
    }
}

export class TaskCompleteResponse implements BaseResponse<TaskDTO> {
    public success: boolean;
    public message: string;
    public data: {
        task: TaskDTO | null
    };

    constructor(origin: TaskCompleteResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// SendMessage: Client sends a message to TG by task_id
export class TaskSendMessageRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public text: string;

    constructor(origin: Partial<TaskSendMessageRequest>) {
        if (!origin.id || !origin.text) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.text = origin.text;
    }
    static self(unsafe: TaskSendMessageRequest) {
        return new TaskSendMessageRequest(unsafe);
    }
}

export class TaskSendMessageResponse implements BaseResponse<null> {
    public success: boolean;
    public message: string;

    constructor(origin: TaskSendMessageResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}
