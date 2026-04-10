import Repository from "../../lib/repository";
import { DemoEntity } from "../../../shared/modules/demo/demo.entity";

const demoRepository: Repository<DemoEntity> = Repository.instance("Demo");

export class DemoService {
    static async find(page: number, filter: Partial<DemoEntity>): Promise<{ list: DemoEntity[]; total: number }> {
        const list = await demoRepository.find(filter, { offset: (page - 1) * 10, limit: 10 });
        const total = await demoRepository.count(filter);
        return { list, total };
    }

    static async findOne(id: string): Promise<DemoEntity | null> {
        return await demoRepository.findOne({ id });
    }

    static async create(data: Partial<DemoEntity>): Promise<DemoEntity> {
        return await demoRepository.insert(data);
    }

    static async createMany(items: { name: string }[]): Promise<DemoEntity[]> {
        const results: DemoEntity[] = [];
        for (const item of items) {
            const result = await demoRepository.insert({ name: item.name });
            results.push(result as DemoEntity);
        }
        return results;
    }

    static async delete(id: string): Promise<void> {
        await demoRepository.delete({ id });
    }
}
