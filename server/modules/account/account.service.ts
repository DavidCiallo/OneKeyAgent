import Repository from "../../lib/repository";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import { generateApiKey } from "../ai/ai.auth";

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

    static async findAll(): Promise<AccountEntity[]> {
        return await accountRepository.find({ delete_time: null });
    }

    static async findByEmail(email: string): Promise<AccountEntity | null> {
        return await accountRepository.findIgnoreDelete({ email });
    }

    static async findActiveByEmail(email: string): Promise<AccountEntity | null> {
        return await accountRepository.findOne({ email });
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

    /** Atomically update account balance by delta */
    static async updateBalance(account_id: string, delta: number): Promise<void> {
        if (delta === 0) return;
        await accountRepository.atomicPatch({ id: account_id }, (row) => {
            if (!row) return null;
            return { balance: (row.balance || 0) + delta };
        });
    }

    /** Get account balance from persisted field */
    static async getBalance(account_id: string): Promise<number> {
        const account = await this.findOne(account_id);
        return account?.balance ?? 0;
    }
}