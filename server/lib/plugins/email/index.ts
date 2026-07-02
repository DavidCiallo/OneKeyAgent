import { SettingsService } from "../../../modules/settings/settings.service";
import type { EmailDriver } from "./interface";
import { ResendDriver } from "./resend";
import { NullDriver } from "./null";

export class Email {
    private static _instance: EmailDriver;

    static instance(): EmailDriver {
        if (!this._instance) {
            this._instance = SettingsService.get("resend_api_key")
                ? new ResendDriver()
                : new NullDriver();
        }
        return this._instance;
    }
}
