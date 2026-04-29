import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { TaskEntity, TaskDTO } from "./mcp.entity";

// ===== Task Create (for internal TG polling use) =====

export class TaskCreateBody {
    public task: string;
    public folder: string;
    public user: string;

    constructor(origin: { task: string; folder: string; user: string }) {
        if (!origin.task) throw new Error("task is required");
        this.task = origin.task;
        this.folder = origin.folder || "";
        this.user = origin.user || "";
    }

    static self(unsafe: TaskCreateBody) {
        return new TaskCreateBody(unsafe);
    }
}

export class TaskCreateRequest implements BaseRequest {
    public auth?: string;
    public task: TaskCreateBody;

    constructor(origin: Partial<TaskCreateRequest>) {
        if (!origin.task) throw new Error("task is required");
        origin.auth && (this.auth = origin.auth);
        this.task = TaskCreateBody.self(origin.task);
    }
    static self(unsafe: TaskCreateRequest) {
        return new TaskCreateRequest(unsafe);
    }
}

export class TaskCreateResponse implements BaseResponse<TaskDTO> {
    public success: boolean;
    public message: string;
    public data: { task: TaskDTO | null };

    constructor(origin: TaskCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// ===== Task Poll (get next pending - for cline) =====

export class TaskPollRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<TaskPollRequest>) {
        this.auth = origin.auth;
    }
    static self(unsafe: TaskPollRequest) {
        return new TaskPollRequest(unsafe);
    }
}

export class TaskPollResponse implements BaseResponse<TaskDTO> {
    public success: boolean;
    public message: string;
    public data: { task: TaskDTO | null };

    constructor(origin: TaskPollResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// ===== Task Update (status & summary - for cline to report completion) =====

export class TaskUpdateBody {
    public status?: "pending" | "running" | "done" | "failed";
    public summary?: string;

    constructor(origin: Partial<Pick<TaskEntity, "status" | "summary">>) {
        if (!origin.status && origin.summary === undefined) {
            throw new Error("At least one field is required");
        }
        origin.status && (this.status = origin.status);
        origin.summary !== undefined && (this.summary = origin.summary);
    }

    static self(unsafe: TaskUpdateBody) {
        return new TaskUpdateBody(unsafe);
    }
}

export class TaskUpdateRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public task: TaskUpdateBody;

    constructor(origin: Partial<TaskUpdateRequest>) {
        if (!origin.id || !origin.task) throw new Error("id and task are required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.task = TaskUpdateBody.self(origin.task);
    }
    static self(unsafe: TaskUpdateRequest) {
        return new TaskUpdateRequest(unsafe);
    }
}

export class TaskUpdateResponse implements BaseResponse<TaskDTO> {
    public success: boolean;
    public message: string;
    public data: { task: TaskDTO | null };

    constructor(origin: TaskUpdateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}