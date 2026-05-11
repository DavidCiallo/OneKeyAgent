import Repository from "../../lib/repository";
import { ProviderEntity } from "../../../shared/modules/provider/provider.entity";

const providerRepository: Repository<ProviderEntity> = Repository.instance("Provider");

// Runtime call stats (in-memory)
const successCount = new Map<string, number>();
const failCount = new Map<string, number>();

// Reset stats daily at midnight
const resetStats = () => {
    successCount.clear();
    failCount.clear();
};
const msUntilMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime() - now.getTime();
};
setTimeout(() => {
    resetStats();
    setInterval(resetStats, 24 * 60 * 60 * 1000);
}, msUntilMidnight());

export class ProviderService {
    static recordSuccess(id: string) {
        successCount.set(id, (successCount.get(id) || 0) + 1);
    }

    static recordFail(id: string) {
        failCount.set(id, (failCount.get(id) || 0) + 1);
    }

    static async find(page: number, filter: Partial<ProviderEntity>): Promise<{ list: ProviderEntity[], total: number }> {
        const list = (await providerRepository.find(filter))
            .sort((a, b) => a.modelAlias.localeCompare(b.modelAlias))
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
        const all = await providerRepository.find({ modelAlias: alias, enabled: 1 });
        return all.sort((a, b) => {
            const aSuccess = successCount.get(a.id) || 0;
            const bSuccess = successCount.get(b.id) || 0;
            const aFail = failCount.get(a.id) || 0;
            const bFail = failCount.get(b.id) || 0;
            return a.priority - b.priority || aSuccess - bSuccess || aFail - bFail || Math.random() - 0.5;
        });
    }

    /** Increase or decrease a provider's priority */
    static async updatePriority(id: string, delta: number): Promise<void> {
        const p = await providerRepository.findOne({ id });
        if (!p) throw "Provider not found";
        const newPriority = Math.max(1, p.priority + delta);
        await providerRepository.update({ id }, { priority: newPriority } as any);
    }
}
