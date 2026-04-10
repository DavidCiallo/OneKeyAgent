import { aesDecrypt, aesEncrypt, hashGenerate } from "../../methods/crypto";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import Repository from "../../lib/repository";

const accountRepository: Repository<AccountEntity> = Repository.instance("Account");

export async function loginUser(email: string, password: string): Promise<{ token?: string }> {
    password = hashGenerate(password);
    const emailItem = await accountRepository.findOne({ email, password });
    if (emailItem) {
        return { token: genTokenForIdentify(email) };
    } else {
        return {};
    }
}

export async function registerUser(name: string, email: string, password: string): Promise<AccountEntity | null> {
    const exist = await accountRepository.findOne({ email });
    if (exist) { return null; }
    password = hashGenerate(password);
    return await accountRepository.insert({ name, email, password });
}

export function genTokenForIdentify(identity: string, expried: number = 1000 * 60 * 60 * 24): string {
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
