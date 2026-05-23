import { settingsRoutes } from "../../../shared/modules/settings/settings.router";
import {
    SettingsListRequest,
    SettingsSaveRequest,
    SettingsEntry,
} from "../../../shared/modules/settings/settings.interface";
import { getAccountByEmail } from "../auth/auth.service";
import { getIdentifyByVerify } from "../auth/auth.service";
import { SettingsService } from "./settings.service";

async function list(request: SettingsListRequest) {
    request = SettingsListRequest.self(request);
    await requireAdmin(request?.auth);

    const all = SettingsService.getAll();
    const entries: SettingsEntry[] = Object.entries(all).map(([key, value]) => ({ key, value }));

    return { entries };
}

async function save(request: SettingsSaveRequest) {
    request = SettingsSaveRequest.self(request);
    const email = getIdentifyByVerify(request.auth || "");
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account || !account.is_admin) throw "Admin only";

    const map: Record<string, string> = {};
    for (const entry of request.entries) {
        map[entry.key] = entry.value;
    }
    await SettingsService.setMany(map);

    return {};
}

async function requireAdmin(auth?: string): Promise<void> {
    if (!auth) throw "Authorization failed";
    const email = getIdentifyByVerify(auth);
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account || !account.is_admin) throw "Permission denied";
}

export const settingsMount = {
    routes: settingsRoutes,
    handlers: { list, save },
};
