import { nanoid } from "nanoid";
import Repository from "../../lib/repository";
import { GiftCardEntity } from "../../../shared/modules/gift_card/gift_card.entity";
import { AccountService } from "../account/account.service";

const cardRepo = Repository.instance<GiftCardEntity>("GiftCard");

export class GiftCardService {

    // ─── Generate a single gift card ───

    static async create(planName: string, durationDays: number): Promise<GiftCardEntity> {
        const raw = nanoid(32).replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 16);
        const code = raw.padEnd(16, "X");
        return await cardRepo.insert({
            code,
            plan_name: planName,
            duration_days: durationDays,
            status: "unused",
            redeemed_by: null,
            redeemed_at: null,
        });
    }

    // ─── List all gift cards ───

    static async list(): Promise<GiftCardEntity[]> {
        return await cardRepo.find({ delete_time: null });
    }

    // ─── Find by code ───

    static async findByCode(code: string): Promise<GiftCardEntity | null> {
        return await cardRepo.findOne({ code, delete_time: null });
    }

    // ─── Redeem a gift card ───

    static async redeem(card: GiftCardEntity, accountId: string): Promise<void> {
        const now = Date.now();

        // Mark card as redeemed
        await cardRepo.update({ id: card.id }, {
            status: "redeemed",
            redeemed_by: accountId,
            redeemed_at: now,
            update_time: now,
        });

        // Upgrade the account
        await SubscriptionService.upgradeAccount(accountId, card.plan_name, card.duration_days);
    }

    // ─── Hard delete expired unused cards ───

    static async cleanupExpired(before: number): Promise<number> {
        const cards = await cardRepo.find({ status: "unused", delete_time: null });
        let deleted = 0;
        for (const card of cards) {
            if (card.create_time < before) {
                await cardRepo.hardDelete({ id: card.id });
                deleted++;
            }
        }
        return deleted;
    }
}

// Lazy import to avoid circular dependency
import { SubscriptionService } from "./subscription.service";