import { hashGenerate } from "../methods/crypto";
import { AccountService } from "../modules/account/account.service";
import { generateApiKey } from "../modules/ai/ai.auth";
import { SettingsService } from "../modules/settings/settings.service";
import { config } from "dotenv";
config();

export async function initialize() {
    // Load settings from DB into memory cache
    await SettingsService.loadFromDb();

    // --- Admin account creation ---

    if (process.env.ADMIN_NAME && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
        const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
        const exist = await AccountService.findByEmail(ADMIN_EMAIL);
        if (exist && !exist.delete_time) return;
        await AccountService.create({
            name: ADMIN_NAME,
            email: ADMIN_EMAIL,
            password: hashGenerate(ADMIN_PASSWORD),
            api_key: generateApiKey(),
            is_admin: 1,
        });
    }
}
