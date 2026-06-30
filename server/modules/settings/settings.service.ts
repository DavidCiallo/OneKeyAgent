import Repository from "../../lib/repository";
import { SettingsEntity } from "../../../shared/modules/settings/settings.entity";

const settingsRepo: Repository<SettingsEntity> = Repository.instance("Settings");

/** Loaded settings cache (memory) */
const cache = new Map<string, string>();

/** Keys recognized by this service with their env fallback */
const SETTING_KEYS: Record<string, string> = {
    "tg_bot_api_base_url": "TG_BOT_API_BASE_URL",
    "tg_user_id": "TG_USER_ID",
    "nowpayments_api_key": "NOWPAYMENTS_API_KEY",
    "ipn_secret": "IPN_SECRET",
    "ipn_callback_url": "IPN_CALLBACK_URL",
    "resend_api_key": "RESEND_API_KEY",
    "email_from": "EMAIL_FROM",
    "allowed_register_domains": "ALLOWED_REGISTER_DOMAINS",
    "client_url": "CLIENT_URL",
    "enable_recharge": "ENABLE_RECHARGE",
    "daily_register_limit": "DAILY_REGISTER_LIMIT",
};

const SETTING_DEFAULTS: Record<string, string> = {
    "enable_recharge": "true",
    "daily_register_limit": "5",
};

export class SettingsService {
    /** Load all settings from DB into memory, falling back to process.env */
    static async loadFromDb(): Promise<void> {
        cache.clear();
        const rows = await settingsRepo.find({});
        for (const row of rows) {
            cache.set(row.key, row.value);
        }
        // Fallback to process.env for keys not in DB
        for (const [key, envKey] of Object.entries(SETTING_KEYS)) {
            if (!cache.has(key)) {
                const envVal = process.env[envKey];
                if (envVal !== undefined) {
                    cache.set(key, envVal);
                }
            }
        }
    }

    /** Synchronous get from memory cache, with default fallback */
    static get(key: string): string {
        const val = cache.get(key);
        return val !== undefined ? val : (SETTING_DEFAULTS[key] || "");
    }

    /** Get all known settings (for admin list API) */
    static getAll(): Record<string, string> {
        const result: Record<string, string> = {};
        for (const key of Object.keys(SETTING_KEYS)) {
            const val = cache.get(key);
            result[key] = val !== undefined ? val : (SETTING_DEFAULTS[key] || "");
        }
        return result;
    }

    /** Update a single setting in DB and memory */
    static async set(key: string, value: string): Promise<void> {
        cache.set(key, value);
        const existing = await settingsRepo.findOne({ key });
        if (existing) {
            await settingsRepo.update({ key }, { value });
        } else {
            await settingsRepo.insert({ key, value });
        }
    }

    /** Batch update settings from admin panel */
    static async setMany(entries: Record<string, string>): Promise<void> {
        for (const [key, value] of Object.entries(entries)) {
            if (key in SETTING_KEYS) {
                await SettingsService.set(key, value);
            }
        }
    }
}
