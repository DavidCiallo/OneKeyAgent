import Repository from "../../lib/repository";
import { ModelEntity } from "../../../shared/modules/model/model.entity";

const modelRepository: Repository<ModelEntity> = Repository.instance("Model");

export class ModelService {
    static async find(page: number, filter: Partial<ModelEntity>): Promise<{ list: ModelEntity[], total: number }> {
        const list = await modelRepository.find(filter);
        list.sort((a, b) => a.alias.localeCompare(b.alias));
        const total = await modelRepository.count(filter);
        return { list: list.slice((page - 1) * 10, page * 10), total };
    }

    static async findOne(id: string): Promise<ModelEntity | null> {
        return await modelRepository.findOne({ id });
    }

    static async findByAlias(alias: string): Promise<ModelEntity[]> {
        return await modelRepository.find({ alias });
    }

    static async create(data: Partial<ModelEntity>): Promise<ModelEntity> {
        if (data.alias) {
            const existing = await modelRepository.findIgnoreDelete({ alias: data.alias });
            if (existing && existing.delete_time) {
                await modelRepository.update({ id: existing.id }, { ...data, id: existing.id, delete_time: null }, true);
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
