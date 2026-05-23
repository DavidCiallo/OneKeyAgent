import Repository from "../../lib/repository";
import { TransactionEntity } from "../../../shared/modules/subscription_record/subscription_record.entity";

const recordRepo = Repository.instance<TransactionEntity>("Transaction");

export class SubscriptionService {

    // ─── Record management ───

    static async getRecordsByAccount(account_id: string): Promise<TransactionEntity[]> {
        return await recordRepo.find({ account_id: account_id, delete_time: null });
    }

    static async createRecord(data: Partial<TransactionEntity>): Promise<TransactionEntity> {
        return await recordRepo.insert(data);
    }

    static async updateRecordByTxid(txid: string, data: Partial<TransactionEntity>): Promise<void> {
        await recordRepo.update({ txid }, data);
    }

    static async findPendingRecords(): Promise<TransactionEntity[]> {
        return await recordRepo.find({ status: "pending", delete_time: null });
    }
}