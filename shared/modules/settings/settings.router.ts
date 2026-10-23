import {
    SettingsListRequest, SettingsListResponse,
    SettingsSaveRequest, SettingsSaveResponse,
} from "./settings.interface";

export const settingsRoutes = {
    base: "/api",
    prefix: "/settings",
    list: { path: "/list", request: {} as SettingsListRequest, response: {} as SettingsListResponse },
    save: { path: "/save", request: {} as SettingsSaveRequest, response: {} as SettingsSaveResponse },
} as const;
