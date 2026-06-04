import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { AccountEntity } from "./account.entity";


// DTO fields must come only from the entity — no extra fields allowed
// Additional business fields (e.g. page for queries) should be added in requests, not the entity

// Base DTO
// Server-side only — constructs a safe response object
export class AccountDTO {
    public id: string;
    public name: string;
    public email: string;
    public api_key: string;
    public is_admin: number;
    public tg_chat_id: string | null;
    public balance: number;

    constructor(origin: AccountEntity) {
        this.id = origin.id;
        this.name = origin.name;
        this.email = origin.email;
        this.api_key = origin.api_key || "";
        this.is_admin = origin.is_admin;
        this.tg_chat_id = origin.tg_chat_id || null;
        this.balance = origin.balance ?? 0;
    }
}

// Client DTO
// throw is only used within constructors

// Client side: use `new` to construct valid requests; invalid local requests will throw
// Server side: use `self` for reconstruction; invalid requests are rejected with an error response

export class AccountQueryBody {
    public id?: string;
    public name?: string;
    public email?: string;

    constructor(origin: Partial<AccountEntity>) {
        if (false) throw new Error("Unexpected error");
        origin.id && (this.id = origin.id);
        origin.name && (this.name = origin.name);
        origin.email && (this.email = origin.email);
    }

    static self(unsafe: AccountQueryBody) {
        return new AccountQueryBody(unsafe);
    }
}

export class AccountCreateBody {
    public name: string;
    public email: string;
    public password: string;
    public api_key: string;
    public is_admin: number;

    constructor(origin: Pick<AccountEntity, "name" | "email" | "password"> & Partial<Pick<AccountEntity, "api_key" | "is_admin">>) {
        if (!origin.name || !origin.email || !origin.password) {
            throw new Error("Name and email are required");
        }
        this.name = origin.name;
        this.email = origin.email;
        this.password = origin.password;
        this.api_key = origin.api_key || "";
        this.is_admin = origin.is_admin ?? 0;
    }

    static self(unsafe: AccountCreateBody) {
        return new AccountCreateBody(unsafe);
    }
}

export class AccountUpdateBody {
    public name?: string;
    public email?: string;
    public password?: string;
    public is_admin?: number;

    constructor(origin: Partial<AccountEntity> = {}) {
        if (!origin.name && !origin.email && !origin.password && origin.is_admin === undefined) {
            throw new Error("At least one field is required");
        }
        origin.name && (this.name = origin.name);
        origin.email && (this.email = origin.email);
        origin.password && (this.password = origin.password);
        origin.is_admin !== undefined && (this.is_admin = origin.is_admin);
    }

    static self(unsafe: AccountUpdateBody) {
        return new AccountUpdateBody(unsafe);
    }
}

export class AccountListRequest implements BaseRequest {
    public auth?: string;
    public page: number;
    public filter?: AccountQueryBody;

    constructor(origin: Partial<AccountListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        origin.filter && (this.filter = AccountQueryBody.self(origin.filter));
        this.page = Number(origin.page || 1);
    }
    static self(unsafe: AccountListRequest) {
        return new AccountListRequest(unsafe);
    }
}

export class AccountListResponse implements BaseResponse<AccountDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: AccountDTO[],
        total: number
    };

    constructor(origin: AccountListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountDetailRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: AccountDetailRequest) {
        if (!origin.id) {
            throw new Error("Id is required");
        }
        this.id = origin.id;
    }
    static self(unsafe: AccountDetailRequest) {
        return new AccountDetailRequest(unsafe);
    }
}

export class AccountDetailResponse implements BaseResponse<AccountDTO> {
    public success: boolean;
    public message: string;
    public data: {
        account: AccountDTO | null
    };

    constructor(origin: AccountDetailResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountCreateRequest implements BaseRequest {
    public auth?: string;
    public account: AccountCreateBody;

    constructor(origin: Partial<AccountCreateRequest>) {
        if (!origin.account) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.account = AccountCreateBody.self(origin.account);
    }
    static self(unsafe: AccountCreateRequest) {
        return new AccountCreateRequest(unsafe);
    }
}

export class AccountCreateResponse implements BaseResponse<AccountDTO> {
    public success: boolean;
    public message: string;
    public data: {
        account: AccountDTO | null
    };

    constructor(origin: AccountCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountUpdateRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public account: AccountUpdateBody;

    constructor(origin: Partial<AccountUpdateRequest>) {
        if (!origin.id || !origin.account) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.account = AccountUpdateBody.self(origin.account);
    }
    static self(unsafe: AccountUpdateRequest) {
        return new AccountUpdateRequest(unsafe);
    }
}

export class AccountUpdateResponse implements BaseResponse<AccountDTO> {
    public success: boolean;
    public message: string;
    public data: {
        account: AccountDTO | null
    };

    constructor(origin: AccountUpdateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountDeleteRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<AccountDeleteRequest>) {
        if (!origin.id) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
    }
    static self(unsafe: AccountDeleteRequest) {
        return new AccountDeleteRequest(unsafe);
    }
}

export class AccountDeleteResponse implements BaseResponse<AccountDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: AccountDeleteResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}

export class AccountProfileRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<AccountProfileRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: AccountProfileRequest) {
        return new AccountProfileRequest(unsafe);
    }
}

export class AccountProfileResponse implements BaseResponse<AccountDTO> {
    public success: boolean;
    public message: string;
    public data: {
        account: AccountDTO | null;
        weeklyUsage: number;
        balance: number;
    };

    constructor(origin: AccountProfileResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountRegenerateRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<AccountRegenerateRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: AccountRegenerateRequest) {
        return new AccountRegenerateRequest(unsafe);
    }
}

export class AccountRegenerateResponse implements BaseResponse<AccountDTO> {
    public success: boolean;
    public message: string;
    public data: {
        api_key: string
    };

    constructor(origin: AccountRegenerateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// ========== Export / Import ==========

export interface ExportData {
    version: number;
    exported_at: number;
    data: {
        accounts?: any[];
        models?: any[];
        providers?: any[];
        roles?: any[];
        account_roles?: any[];
        transactions?: any[];
        tasks?: any[];
        usage_buckets?: any[];
        gift_cards?: any[];
        settings?: any[];
        session_reasonings?: any[];
    };
}

export class AccountExportRequest implements BaseRequest {
    public auth?: string;
    constructor(origin: Partial<AccountExportRequest>) {
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: AccountExportRequest) {
        return new AccountExportRequest(unsafe);
    }
}

export class AccountExportResponse implements BaseResponse<any> {
    public success: boolean;
    public message: string;
    public data?: ExportData;

    constructor(origin: AccountExportResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountImportRequest implements BaseRequest {
    public auth?: string;
    public data: ExportData;

    constructor(origin: Partial<AccountImportRequest>) {
        if (!origin.data) throw new Error("data is required");
        origin.auth && (this.auth = origin.auth);
        this.data = origin.data;
    }
    static self(unsafe: AccountImportRequest) {
        return new AccountImportRequest(unsafe);
    }
}

export class AccountImportResponse implements BaseResponse<{ imported: Record<string, number> }> {
    public success: boolean;
    public message: string;
    public data?: { imported: Record<string, number> };

    constructor(origin: AccountImportResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}