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

    /** Sum usage costs for a set of logs using the same formula everywhere */
    static computeUsageCost(logs: { inputTokens: number; outputTokens: number; inputPrice?: number; outputPrice?: number }[]): number {
        let total = 0;
        for (const log of logs) {
            total += (log.input_tokens * (log.input_price || 0) + log.output_tokens * (log.output_price || 0)) / 1_000_000;
        }
        return Math.round(total * 1_000_000) / 1_000_000;
    }

    /** Atomically update account balance by delta */
    static async updateBalance(accountId: string, delta: number): Promise<void> {
        if (delta === 0) return;
        await accountRepository.atomicPatch({ id: accountId }, (row) => {
            if (!row) return null;
            return { balance: (row.balance || 0) + delta };
        });
    }

    /** Get account balance from persisted field */
    static async getBalance(accountId: string): Promise<number> {
        const account = await this.findOne(accountId);
        return account?.balance ?? 0;
    }

    /** One-time init: compute and persist balance for accounts that haven't been initialized yet (balance === 0 and has history) */
    static async initBalances(): Promise<void> {
        const accounts = await accountRepository.find({ balance: 0 });
        let count = 0;
        for (const acct of accounts) {
            const balance = await this.computeBalance(acct.id);
            if (balance !== 0) {
                await accountRepository.update({ id: acct.id }, { balance } as any);
                count++;
            }
        }
        if (count > 0) {
            console.log(`[AccountService] Initialized balances for ${count} accounts`);
        }
    }

    /** Compute balance from transactions + gift cards - usage costs (original aggregation) */
    static async computeBalance(accountId: string): Promise<number> {
        const txRepo = Repository.instance<any>("Transaction");
        const transactions = await txRepo.find({ account_id: accountId, status: "confirmed", delete_time: null });
        const txTotal = transactions.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        const cardRepo = Repository.instance<any>("gift_card");
        const giftCards = await cardRepo.find({ redeemed_by: accountId, status: "redeemed" });
        const gcTotal = giftCards.reduce((sum: number, c: any) => sum + (c.token_amount || 0), 0);

        const usageRepo = Repository.instance<any>("usage_log");
        const usageLogs = await usageRepo.find({ account_id: accountId, delete_time: null });

        return txTotal + gcTotal - this.computeUsageCost(usageLogs);
    }
}