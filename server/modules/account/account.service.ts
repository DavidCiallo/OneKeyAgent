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

    /** Compute account balance from transactions + gift cards - usage costs */
    static async getBalance(accountId: string): Promise<number> {
        // SUM of confirmed topup/bonus transactions
        const txRepo = Repository.instance<any>("Transaction");
        const transactions = await txRepo.find({ account_id: accountId, status: "confirmed", delete_time: null });
        const txTotal = transactions.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        // SUM of redeemed gift cards
        const cardRepo = Repository.instance<any>("GiftCard");
        const giftCards = await cardRepo.find({ redeemed_by: accountId, status: "redeemed" });
        const gcTotal = giftCards.reduce((sum: number, c: any) => sum + (c.token_amount || 0), 0);

        // SUM of usage costs
        const usageRepo = Repository.instance<any>("UsageLog");
        const usageLogs = await usageRepo.find({ accountId, delete_time: null });
        const usageTotal = usageLogs.reduce((sum: number, log: any) => {
            const cost = (log.inputTokens * (log.inputPrice || 0) + log.outputTokens * (log.outputPrice || 0)) / 1_000_000;
            return sum + cost;
        }, 0);

        return Math.round((txTotal + gcTotal - usageTotal) * 1_000_000) / 1_000_000;
    }
}