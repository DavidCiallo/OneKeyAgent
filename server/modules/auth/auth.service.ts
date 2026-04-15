import { aesDecrypt, aesEncrypt, hashGenerate } from "../../methods/crypto";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import Repository from "../../lib/repository";
import { generateApiKey } from "../ai/ai.auth";
import { RoleService, AccountRoleService } from "../role/role.service";

const ALL_MENUS = ["model", "usage", "account"];
const accountRepository: Repository<AccountEntity> = Repository.instance("Account");

export async function loginUser(email: string, password: string): Promise<{ token?: string; is_admin?: number; roles?: { name: string; type: string }[] }> {
    password = hashGenerate(password);
    const emailItem = await accountRepository.findOne({ email, password });
    if (emailItem) {
        const roles = emailItem.is_admin
            ? ALL_MENUS.map(name => ({ name, type: "menu" }))
            : (await AccountRoleService.findByAccount(emailItem.id)).map(r => ({ name: r.name, type: r.type }));
        return { token: genTokenForIdentify(email), is_admin: emailItem.is_admin, roles };
    } else {
        return {};
    }
}

export async function registerUser(name: string, email: string, password: string, isAdmin: number = 0): Promise<{ account?: AccountEntity; apiKey?: string }> {
    const exist = await accountRepository.findIgnoreDelete({ email });
    if (exist) { return {}; }
    password = hashGenerate(password);
    const apiKey = generateApiKey();
    const account = await accountRepository.insert({ name, email, password, apiKey, is_admin: isAdmin });
    if (!account) return {};
    return { account, apiKey };
}

export async function getAccountByEmail(email: string): Promise<AccountEntity | null> {
    return await accountRepository.findOne({ email });
}

export function genTokenForIdentify(identity: string, expried: number = 1000 * 60 * 60 * 24 * 3): string {
    expried = Date.now() + expried;
    const token = [identity, expried.toString()].join("|-|");
    return aesEncrypt(token);
}

export function getIdentifyByVerify(token: string): string | null {
    const dt = aesDecrypt(token);
    if (!dt) return null;
    const [identity, expried] = dt.split("|-|");
    if (Date.now() > Number(expried)) return null;
    return identity;
}