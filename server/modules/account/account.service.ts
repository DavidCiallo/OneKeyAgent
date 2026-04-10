import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";

const accountRepository: Repository<AccountEntity> = Repository.instance("Account");

export class AccountService {
    static async find(page: number, filter: Partial<AccountEntity>): Promise<{ list: AccountEntity[], total: number }> {
        const list = await accountRepository.find(filter, { offset: (page - 1) * 10, limit: 10 });
        const total = await accountRepository.count(filter);
        return { list, total };
    }

    static async findOne(id: string): Promise<AccountEntity | null> {
        const result = await accountRepository.findOne({ id });
        if (!result) return null;
        return result;
    }

    static async create(data: Partial<AccountEntity>): Promise<AccountEntity> {
        const result = await accountRepository.insert(data);
        return result;
    }

    static async update(id: string, data: Partial<AccountEntity>): Promise<AccountEntity | null> {
        await accountRepository.update({ id }, data);
        const result = await accountRepository.findOne({ id });
        if (!result) return null;
        return result;
    }

    static async delete(id: string): Promise<void> {
        await accountRepository.delete({ id });
    }
}