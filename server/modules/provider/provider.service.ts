import Repository from "../../lib/repository";
import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";

const providerRepository: Repository<ProviderEntity> = Repository.instance("Provider");

export class ProviderService {
    static async find(page: number, filter: Partial<ProviderEntity>): Promise<{ list: ProviderEntity[], total: number }> {
        const list = await providerRepository.find(filter, { offset: (page - 1) * 10, limit: 10 });
        const total = await providerRepository.count(filter);
        return { list, total };
    }

    static async findOne(id: string): Promise<ProviderEntity | null> {
        return await providerRepository.findOne({ id });
    }

    static async create(data: Partial<ProviderEntity>): Promise<ProviderEntity> {
        return await providerRepository.insert(data);
    }

    static async update(id: string, data: Partial<ProviderEntity>): Promise<ProviderEntity | null> {
        await providerRepository.update({ id }, data);
        return await providerRepository.findOne({ id });
    }

    static async delete(id: string): Promise<void> {
        await providerRepository.delete({ id });
    }

    /** Get all enabled providers for a given model alias, ordered by priority */
    static async getProvidersByAlias(alias: string): Promise<ProviderEntity[]> {
        const all = await providerRepository.find({ modelAlias: alias, enabled: 1 });
        return all.sort((a, b) => a.name.localeCompare(b.name) || a.priority - b.priority);
    }

    /** Swap priority between two providers */
    static async swapPriority(id1: string, id2: string): Promise<void> {
        const [p1, p2] = await Promise.all([
            providerRepository.findOne({ id: id1 }),
            providerRepository.findOne({ id: id2 }),
        ]);
        if (!p1 || !p2) throw "Provider not found";
        if (p1.name !== p2.name) throw "Cannot swap priority between providers with different names";

        await providerRepository.update({ id: id1 }, { priority: p2.priority } as any);
        await providerRepository.update({ id: id2 }, { priority: p1.priority } as any);
    }
}
