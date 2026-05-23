import { AccountEntity } from "../../../shared/modules/account/account.entity";
import Repository from "../../lib/repository";
import crypto from "crypto";

const accountRepo = Repository.instance<AccountEntity>("Account");

export function validateApiKey(key: string): boolean {
    if (!key || typeof key !== "string") return false;
    return key.startsWith("sk-") && key.length === 39;
}

export async function getAccountIdByApiKey(key: string): Promise<string | null> {
    if (!key) return null;
    const account = await accountRepo.findOne({ api_key: key });
    return account?.id || null;
}

export function generateApiKey(): string {
    return "sk-" + crypto.randomUUID();
}