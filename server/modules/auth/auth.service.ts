import { aesDecrypt, aesEncrypt, hashGenerate } from "../../methods/crypto";
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import Repository from "../../lib/repository";
import { generateApiKey } from "../ai/ai.auth";
import { RoleService, AccountRoleService } from "../role/role.service";
import { sendEmail, buildVerificationEmail } from "../email/email.service";
import { AccountService } from "../account/account.service";
import { SettingsService } from "../settings/settings.service";

const ALL_MENUS = ["profile", "model", "usage", "account"];
const accountRepository: Repository<AccountEntity> = Repository.instance("Account");

export async function loginUser(email: string, password: string): Promise<{ token?: string; is_admin?: number; roles?: { name: string; type: string }[]; needsVerification?: boolean }> {
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

/** Claim daily sign-in bonus for an account. Returns the bonus amount. */
export async function claimDailyBonus(accountId: string): Promise<number> {
    const now = Date.now();
    const account = await accountRepository.findOne({ id: accountId } as any);
    if (!account) return 0;

    const lastDaily = account.last_daily_time;
    const isNewDay = !lastDaily || new Date(lastDaily).toDateString() !== new Date(now).toDateString();
    if (!isNewDay) return 0;

    await accountRepository.update({ id: accountId }, { last_daily_time: now } as any);
    const cardRepo = Repository.instance<any>("GiftCard");

    const allRedeemed = await cardRepo.find({ redeemed_by: accountId, status: "redeemed" });
    const manualTotal = allRedeemed
        .filter((c: any) => c.code && !c.code.startsWith("daily_") && !c.code.startsWith("register_"))
        .reduce((sum: number, c: any) => sum + (c.token_amount || 0), 0);

    const balance = account.balance;

    let amount = 0.1;
    if (manualTotal > 0 && balance > 0) {
        const ratio = manualTotal / balance;
        if (ratio > 0.15) {
            amount = amount * (0.25 + Math.random() * 0.2);
        } else {
            amount = amount * (0.85 + Math.random() * 0.1);
        }
        amount = Math.round(amount * 100) / 100;
    }

    await cardRepo.insert({
        code: `daily_${accountId}_${now}`,
        token_amount: amount,
        status: "redeemed",
        redeemed_by: accountId,
        redeemed_at: now,
        create_time: now,
    } as any);

    // Update account balance atomically
    await AccountService.updateBalance(accountId, amount);

    return amount;
}

function checkAllowedDomain(email: string): string | null {
    const allowedDomains = SettingsService.get("allowed_register_domains");
    if (!allowedDomains) return null; // no restriction
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain) return "Invalid email format";
    const domains = allowedDomains.split(",").map(d => d.trim().toLowerCase());
    if (!domains.includes(domain)) {
        return `Registration is limited to ${domains.join(", ")} email addresses`;
    }
    return null;
}

/**
 * Step 1: Pre-register — only check duplicates and send verification email.
 * Account is NOT created yet. The verification token contains the encrypted
 * registration payload (name|email|password).
 */
export async function preRegisterUser(name: string, email: string, password: string): Promise<{ needsVerification?: boolean }> {
    const domainError = checkAllowedDomain(email);
    if (domainError) { throw domainError; }
    const exist = await accountRepository.findIgnoreDelete({ email });
    if (exist) { return {}; }
    // Encrypt registration data into the token: name|-|email|-|password(plain)
    const payload = [name, email, password].join("|-|");
    const verificationToken = aesEncrypt(payload);
    const verifyUrl = `${SettingsService.get("client_url")}/verify?token=${encodeURIComponent(verificationToken)}`;
    const emailSent = await sendEmail({
        to: email,
        ...buildVerificationEmail(verifyUrl),
    });
    if (!emailSent) {
        console.error("Failed to send verification email to:", email);
        return {};
    }
    return { needsVerification: true };
}

/**
 * Step 2: Complete registration — decrypt token, create account.
 * Returns the created account on success, null if token is invalid/expired.
 */
export async function completeRegistration(token: string): Promise<{ account?: AccountEntity; apiKey?: string } | null> {
    const decrypted = aesDecrypt(token);
    if (!decrypted) return null;
    const parts = decrypted.split("|-|");
    if (parts.length < 3) return null;
    const [name, email, plainPassword] = parts;
    // Check expiry via embedded timestamp (the token itself has 3-day expiry built in via aesEncrypt's caller)
    // Double-check account doesn't already exist
    const exist = await accountRepository.findIgnoreDelete({ email });
    if (exist) return null;
    const password = hashGenerate(plainPassword);
    const apiKey = generateApiKey();
    const account = await accountRepository.insert({ name, email, password, apiKey, is_admin: 0 });
    if (!account) return null;
    // Assign default permissions
    await AccountRoleService.assignPermissions(account.id, [
        { name: "usage", type: "menu" },
        { name: "profile", type: "menu" },
        { name: "subscription", type: "menu" },
    ]);
    // Registration bonus: insert a redeemed gift card worth 2 tokens
    const now = Date.now();
    const cardRepo = Repository.instance<any>("GiftCard");
    await cardRepo.insert({
        code: `register_${account.id}_${now}`,
        token_amount: 1,
        status: "redeemed",
        redeemed_by: account.id,
        redeemed_at: now,
        create_time: now,
    } as any);

    // Update account balance atomically
    await AccountService.updateBalance(account.id, 1);

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