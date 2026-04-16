import { AccountEntity } from "../../../shared/modules/account/account.entity";
import Repository from "../../lib/repository";

const accountRepo = Repository.instance<AccountEntity>("Account");

export function validateApiKey(key: string): boolean {
    if (!key || typeof key !== "string") return false;
    return key.startsWith("hex-") && key.length === 40;
}

export async function verifyApiKeyInDb(key: string): Promise<boolean> {
    if (!key) return false;
    const account = await accountRepo.findOne({ apiKey: key });
    return !!account;
}

export function generateApiKey(): string {
    return "hex-" + crypto.randomUUID();
}