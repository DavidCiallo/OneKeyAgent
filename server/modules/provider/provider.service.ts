import Repository from "../../lib/repository";
import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";

const providerRepository: Repository<ProviderEntity> = Repository.instance("Provider");

export class ProviderService {
    static async find(page: number, filter: Partial<ProviderEntity>): Promise<{ list: ProviderEntity[], total: number }> {
        const list = (await providerRepository.find(filter))
            .sort((a, b) => a.model_alias.localeCompare(b.model_alias))
            .slice((page - 1) * 10, page * 10);
        const total = await providerRepository.count(filter);
        return { list, total };
    }

    static async findOne(id: string): Promise<ProviderEntity | null> {
        return await providerRepository.findOne({ id });
    }

    /** Find a provider ignoring soft-delete — used for resolving historical usage names */
    static async findOneIgnoreDelete(id: string): Promise<ProviderEntity | null> {
        return await providerRepository.findIgnoreDelete({ id });
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

    /** Get all enabled providers for a given model alias, ordered by priority and call stats */
    static async getProvidersByAlias(alias: string): Promise<ProviderEntity[]> {
        const all = await providerRepository.find({ model_alias: alias, enabled: 1 });
        return all.sort((a, b) => {
            return a.priority - b.priority || Math.random() - 0.5;
        });
    }

    /** Get all distinct model_aliases (for filter dropdown) */
    static async getModelAliases(): Promise<string[]> {
        const all = await providerRepository.findAllIgnoreDelete();
        const aliases = new Set(all.map(p => p.model_alias).filter(Boolean));
        return Array.from(aliases).sort((a, b) => a.localeCompare(b));
    }

    /** Increase or decrease a provider's priority */
    static async updatePriority(id: string, delta: number): Promise<void> {
        const p = await providerRepository.findOne({ id });
        if (!p) throw "Provider not found";
        const newPriority = Math.max(1, p.priority + delta);
        await providerRepository.update({ id }, { priority: newPriority });
    }
}
