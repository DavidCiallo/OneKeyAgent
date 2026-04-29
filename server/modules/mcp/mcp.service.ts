import Repository from "../../lib/repository";
import { TaskEntity } from "../../../shared/modules/mcp/mcp.entity";

const taskRepository: Repository<TaskEntity> = Repository.instance("Task");

export class McpService {
    static async create(data: Partial<TaskEntity>): Promise<TaskEntity> {
        return await taskRepository.insert(data);
    }

    static async update(id: string, data: Partial<TaskEntity>): Promise<TaskEntity | null> {
        await taskRepository.update({ id }, data);
        return await taskRepository.findOne({ id });
    }

    /** Get next pending task (FIFO) */
    static async getNextPending(): Promise<TaskEntity | null> {
        // find is ordered by create_time desc, so last element is oldest
        const { list } = await McpService.findAllPending();
        if (list.length === 0) return null;
        const task = list[list.length - 1]; // oldest pending (FIFO)
        await taskRepository.update({ id: task.id }, { status: "running" });
        return task;
    }

    private static async findAllPending(): Promise<{ list: TaskEntity[] }> {
        const list = await taskRepository.find({ status: "pending" });
        return { list };
    }
}