import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    SettingsListRequest, SettingsListResponse,
    SettingsSaveRequest, SettingsSaveResponse,
} from "./settings.interface";

export class SettingsRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/settings";
    router = [
        { path: "/list", handler: Function },
        { path: "/save", handler: Function },
    ];

    list!: (query: SettingsListRequest) => Promise<SettingsListResponse>;
    save!: (body: SettingsSaveRequest) => Promise<SettingsSaveResponse>;

    constructor(inject: Function, functions?: {
        list: (query: SettingsListRequest) => Promise<SettingsListResponse>,
        save: (body: SettingsSaveRequest) => Promise<SettingsSaveResponse>
    }) {
        super();
        inject(this, functions);
    }
}
