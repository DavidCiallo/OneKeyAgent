import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";

const modelRepository: Repository<ModelEntity> = Repository.instance("Model");

export class ModelService {
    static async find(page: number, filter: Partial<ModelEntity>): Promise<{ list: ModelEntity[], total: number }> {
        const list = await modelRepository.find(filter, { offset: (page - 1) * 10, limit: 10 });
        const total = await modelRepository.count(filter);
        return { list, total };
    }

    static async findOne(id: string): Promise<ModelEntity | null> {
        return await modelRepository.findOne({ id });
    }

    static async create(data: Partial<ModelEntity>): Promise<ModelEntity> {
        // If a soft-deleted model with the same alias exists, restore it
        if (data.alias) {
            const existing = await modelRepository.findIgnoreDelete({ alias: data.alias });
            if (existing && existing.delete_time) {
                await modelRepository.update({ id: existing.id }, { ...data, id: existing.id, delete_time: null as any });
                return (await modelRepository.findOne({ id: existing.id }))!;
            }
        }
        return await modelRepository.insert(data);
    }

    static async update(id: string, data: Partial<ModelEntity>): Promise<ModelEntity | null> {
        await modelRepository.update({ id }, data);
        return await modelRepository.findOne({ id });
    }

    static async delete(id: string): Promise<void> {
        await modelRepository.delete({ id });
    }
}
