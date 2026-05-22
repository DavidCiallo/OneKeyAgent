import { SettingsRouterInstance } from "../../../shared/modules/settings/settings.router";
import {
    SettingsListRequest, SettingsListResponse,
    SettingsSaveRequest, SettingsSaveResponse,
    SettingsEntry,
} from "../../../shared/modules/settings/settings.interface";
import { inject } from "../../lib/inject";
import { getAccountByEmail, requireAdmin } from "../auth/auth.service";
import { getIdentifyByVerify } from "../auth/auth.service";
import { SettingsService } from "./settings.service";

async function list(request: SettingsListRequest): Promise<SettingsListResponse> {
    request = SettingsListRequest.self(request);
    await requireAdmin(request?.auth);

    const all = SettingsService.getAll();
    const entries: SettingsEntry[] = Object.entries(all).map(([key, value]) => ({ key, value }));

    return new SettingsListResponse({
        success: true,
        message: "success",
        data: { entries },
    });
}

async function save(request: SettingsSaveRequest): Promise<SettingsSaveResponse> {
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

    return new SettingsSaveResponse({
        success: true,
        message: "Settings saved",
    });
}

export const settingsController = new SettingsRouterInstance(inject, { list, save });
