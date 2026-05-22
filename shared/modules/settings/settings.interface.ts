import { BaseRequest, BaseResponse } from "../../lib/default/decorator";

/** Single key-value entry (used in admin settings page) */
export interface SettingsEntry {
    key: string;
    value: string;
}

export class SettingsSaveRequest implements BaseRequest {
    public auth?: string;
    public entries: SettingsEntry[];

    constructor(origin: Partial<SettingsSaveRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.entries = origin.entries || [];
    }
    static self(unsafe: SettingsSaveRequest) {
        return new SettingsSaveRequest(unsafe);
    }
}

export class SettingsSaveResponse implements BaseResponse<null> {
    public success: boolean;
    public message: string;

    constructor(origin: SettingsSaveResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}

export class SettingsListRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<SettingsListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: SettingsListRequest) {
        return new SettingsListRequest(unsafe);
    }
}

export class SettingsListResponse implements BaseResponse<null> {
    public success: boolean;
    public message: string;
    public data?: Record<string, any>;

    constructor(origin: SettingsListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}
