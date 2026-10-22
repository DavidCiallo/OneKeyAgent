import {
    SettingsListRequest, SettingsListResponse,
    SettingsSaveRequest, SettingsSaveResponse,
    SettingsMigrateMoneyRequest, SettingsMigrateMoneyResponse,
} from "./settings.interface";

export const settingsRoutes = {
    base: "/api",
    prefix: "/settings",
    list: { path: "/list", request: {} as SettingsListRequest, response: {} as SettingsListResponse },
    save: { path: "/save", request: {} as SettingsSaveRequest, response: {} as SettingsSaveResponse },
    migrateMoney: { path: "/migrateMoney", request: {} as SettingsMigrateMoneyRequest, response: {} as SettingsMigrateMoneyResponse },
} as const;
