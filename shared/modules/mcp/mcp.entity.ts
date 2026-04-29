import { BaseEntity } from "../../lib/default/base.entity";

export interface TaskEntity extends BaseEntity {
    task: string;
    folder: string;
    user: string;
    status: "pending" | "running" | "done" | "failed";
    summary?: string;
}

export class TaskDTO {
    public id: string;
    public task: string;
    public folder: string;
    public user: string;
    public status: string;
    public summary: string | null;
    public create_time: number;
    public update_time: number | null;
    public delete_time: number | null;

    constructor(origin: TaskEntity) {
        this.id = origin.id;
        this.task = origin.task;
        this.folder = origin.folder;
        this.user = origin.user;
        this.status = origin.status;
        this.summary = origin.summary || null;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}