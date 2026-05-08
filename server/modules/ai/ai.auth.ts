import { AccountEntity } from "../../../shared/modules/account/account.entity";
import Repository from "../../lib/repository";

const accountRepo = Repository.instance<AccountEntity>("Account");

export function validateApiKey(key: string): boolean {
    if (!key || typeof key !== "string") return false;
    return key.startsWith("hex-") || key.startsWith("sk-") && key.length === 40;
}

export async function verifyApiKeyInDb(key: string): Promise<boolean> {
    if (!key) return false;
    const account = await accountRepo.findOne({ apiKey: key });
    return !!account;
}

export async function getAccountIdByApiKey(key: string): Promise<string | null> {
    if (!key) return null;
    const account = await accountRepo.findOne({ apiKey: key });
    return account?.id || null;
}

export function generateApiKey(): string {
    return "sk-" + crypto.randomUUID();
}