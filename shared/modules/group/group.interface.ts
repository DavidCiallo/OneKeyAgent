import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { AccountGroupEntity } from "./group.entity";

export class AccountGroupDTO {
    public id: string;
    public name: string;
    public remark: string;
    /** Live member count, filled by the list query. */
    public member_count: number;
    public create_time: number;
    public update_time: number | null;
    public delete_time: number | null;

    constructor(origin: AccountGroupEntity & { member_count?: number }) {
        this.id = origin.id;
        this.name = origin.name;
        this.remark = origin.remark;
        this.member_count = origin.member_count ?? 0;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}

export class AccountGroupListRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<AccountGroupListRequest> = {}) {
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: AccountGroupListRequest) {
        return new AccountGroupListRequest(unsafe);
    }
}

export class AccountGroupListResponse implements BaseResponse<AccountGroupDTO> {
    public success: boolean;
    public message: string;
    public data: { list: AccountGroupDTO[]; total: number };

    constructor(origin: AccountGroupListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountGroupDetailRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<AccountGroupDetailRequest>) {
        if (!origin.id) throw new Error("id is required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
    }
    static self(unsafe: AccountGroupDetailRequest) {
        return new AccountGroupDetailRequest(unsafe);
    }
}

export class AccountGroupDetailResponse implements BaseResponse<AccountGroupDTO> {
    public success: boolean;
    public message: string;
    public data: { group: AccountGroupDTO; member_ids: string[] };

    constructor(origin: AccountGroupDetailResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountGroupCreateRequest implements BaseRequest {
    public auth?: string;
    public name: string;
    public remark?: string;

    constructor(origin: Partial<AccountGroupCreateRequest>) {
        if (!origin.name) throw new Error("name is required");
        origin.auth && (this.auth = origin.auth);
        this.name = origin.name;
        origin.remark !== undefined && (this.remark = origin.remark);
    }
    static self(unsafe: AccountGroupCreateRequest) {
        return new AccountGroupCreateRequest(unsafe);
    }
}

export class AccountGroupCreateResponse implements BaseResponse<AccountGroupDTO> {
    public success: boolean;
    public message: string;
    public data: { group: AccountGroupDTO };

    constructor(origin: AccountGroupCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountGroupUpdateRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public name: string;
    public remark?: string;

    constructor(origin: Partial<AccountGroupUpdateRequest>) {
        if (!origin.id || !origin.name) throw new Error("id and name are required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.name = origin.name;
        origin.remark !== undefined && (this.remark = origin.remark);
    }
    static self(unsafe: AccountGroupUpdateRequest) {
        return new AccountGroupUpdateRequest(unsafe);
    }
}

export class AccountGroupUpdateResponse implements BaseResponse<AccountGroupDTO> {
    public success: boolean;
    public message: string;
    public data: { group: AccountGroupDTO };

    constructor(origin: AccountGroupUpdateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AccountGroupDeleteRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<AccountGroupDeleteRequest>) {
        if (!origin.id) throw new Error("id is required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
    }
    static self(unsafe: AccountGroupDeleteRequest) {
        return new AccountGroupDeleteRequest(unsafe);
    }
}

export class AccountGroupDeleteResponse implements BaseResponse<AccountGroupDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: AccountGroupDeleteResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}

/** Replace a group's membership with exactly this set of accounts. */
export class AccountGroupAssignRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public account_ids: string[];

    constructor(origin: Partial<AccountGroupAssignRequest>) {
        if (!origin.id || !origin.account_ids) throw new Error("id and account_ids are required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.account_ids = origin.account_ids;
    }
    static self(unsafe: AccountGroupAssignRequest) {
        return new AccountGroupAssignRequest(unsafe);
    }
}

export class AccountGroupAssignResponse implements BaseResponse<AccountGroupDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: AccountGroupAssignResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}

/** The groups one account belongs to. */
export class AccountGroupsRequest implements BaseRequest {
    public auth?: string;
    public account_id: string;

    constructor(origin: Partial<AccountGroupsRequest>) {
        if (!origin.account_id) throw new Error("account_id is required");
        origin.auth && (this.auth = origin.auth);
        this.account_id = origin.account_id;
    }
    static self(unsafe: AccountGroupsRequest) {
        return new AccountGroupsRequest(unsafe);
    }
}

export class AccountGroupsResponse implements BaseResponse<AccountGroupDTO> {
    public success: boolean;
    public message: string;
    public data: { groups: AccountGroupDTO[] };

    constructor(origin: AccountGroupsResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

/** Replace which groups one account is in. */
export class SetAccountGroupsRequest implements BaseRequest {
    public auth?: string;
    public account_id: string;
    public group_ids: string[];

    constructor(origin: Partial<SetAccountGroupsRequest>) {
        if (!origin.account_id || !origin.group_ids) throw new Error("account_id and group_ids are required");
        origin.auth && (this.auth = origin.auth);
        this.account_id = origin.account_id;
        this.group_ids = origin.group_ids;
    }
    static self(unsafe: SetAccountGroupsRequest) {
        return new SetAccountGroupsRequest(unsafe);
    }
}

export class SetAccountGroupsResponse implements BaseResponse<AccountGroupDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: SetAccountGroupsResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}
