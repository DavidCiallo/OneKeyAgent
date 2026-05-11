import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { RoleEntity, RoleType } from "./role.entity";

export class RoleDTO {
    public id: string;
    public name: string;
    public type: string;
    public create_time: number;
    public update_time: number | null;
    public delete_time: number | null;

    constructor(origin: RoleEntity) {
        this.id = origin.id;
        this.name = origin.name;
        this.type = origin.type;
        this.create_time = origin.create_time;
        this.update_time = origin.update_time;
        this.delete_time = origin.delete_time;
    }
}

export class RoleCreateBody {
    public name: string;
    public type: RoleType;

    constructor(origin: Pick<RoleEntity, "name" | "type">) {
        if (!origin.name || !origin.type) {
            throw new Error("name and type are required");
        }
        this.name = origin.name;
        this.type = origin.type;
    }

    static self(unsafe: RoleCreateBody) {
        return new RoleCreateBody(unsafe);
    }
}

export class RoleUpdateBody {
    public name?: string;
    public type?: RoleType;

    constructor(origin: Partial<RoleEntity> = {}) {
        if (!origin.name && !origin.type) {
            throw new Error("At least one field is required");
        }
        origin.name && (this.name = origin.name);
        origin.type && (this.type = origin.type);
    }

    static self(unsafe: RoleUpdateBody) {
        return new RoleUpdateBody(unsafe);
    }
}

export class RoleListRequest implements BaseRequest {
    public auth?: string;
    public page: number;

    constructor(origin: Partial<RoleListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
        this.page = Number(origin.page || 1);
    }
    static self(unsafe: RoleListRequest) {
        return new RoleListRequest(unsafe);
    }
}

export class RoleListResponse implements BaseResponse<RoleDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: RoleDTO[],
        total: number
    };

    constructor(origin: RoleListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class RoleDetailRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: RoleDetailRequest) {
        if (!origin.id) throw new Error("Id is required");
        this.id = origin.id;
    }
    static self(unsafe: RoleDetailRequest) {
        return new RoleDetailRequest(unsafe);
    }
}

export class RoleDetailResponse implements BaseResponse<RoleDTO> {
    public success: boolean;
    public message: string;
    public data: {
        role: RoleDTO | null
    };

    constructor(origin: RoleDetailResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class RoleCreateRequest implements BaseRequest {
    public auth?: string;
    public role: RoleCreateBody;

    constructor(origin: Partial<RoleCreateRequest>) {
        if (!origin.role) throw new Error("role is required");
        origin.auth && (this.auth = origin.auth);
        this.role = RoleCreateBody.self(origin.role);
    }
    static self(unsafe: RoleCreateRequest) {
        return new RoleCreateRequest(unsafe);
    }
}

export class RoleCreateResponse implements BaseResponse<RoleDTO> {
    public success: boolean;
    public message: string;
    public data: {
        role: RoleDTO | null
    };

    constructor(origin: RoleCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class RoleUpdateRequest implements BaseRequest {
    public auth?: string;
    public id: string;
    public role: RoleUpdateBody;

    constructor(origin: Partial<RoleUpdateRequest>) {
        if (!origin.id || !origin.role) throw new Error("id and role are required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
        this.role = RoleUpdateBody.self(origin.role);
    }
    static self(unsafe: RoleUpdateRequest) {
        return new RoleUpdateRequest(unsafe);
    }
}

export class RoleUpdateResponse implements BaseResponse<RoleDTO> {
    public success: boolean;
    public message: string;
    public data: {
        role: RoleDTO | null
    };

    constructor(origin: RoleUpdateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class RoleDeleteRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<RoleDeleteRequest>) {
        if (!origin.id) throw new Error("Id is required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
    }
    static self(unsafe: RoleDeleteRequest) {
        return new RoleDeleteRequest(unsafe);
    }
}

export class RoleDeleteResponse implements BaseResponse<RoleDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: RoleDeleteResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}

// Assign roles to account
export class AssignRolesBody {
    public permissions: { name: string; type: string }[];

    constructor(origin: { permissions: { name: string; type: string }[] }) {
        if (!origin.permissions || !Array.isArray(origin.permissions)) {
            throw new Error("permissions is required");
        }
        this.permissions = origin.permissions;
    }

    static self(unsafe: AssignRolesBody) {
        return new AssignRolesBody(unsafe);
    }
}

export class AssignRolesRequest implements BaseRequest {
    public auth?: string;
    public account_id: string;
    public roles: AssignRolesBody;

    constructor(origin: Partial<AssignRolesRequest>) {
        if (!origin.account_id || !origin.roles) throw new Error("account_id and roles are required");
        origin.auth && (this.auth = origin.auth);
        this.account_id = origin.account_id;
        this.roles = AssignRolesBody.self(origin.roles);
    }
    static self(unsafe: AssignRolesRequest) {
        return new AssignRolesRequest(unsafe);
    }
}

export class AssignRolesResponse implements BaseResponse<RoleDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: AssignRolesResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}

// Get roles by account
export class AccountRolesRequest implements BaseRequest {
    public auth?: string;
    public account_id: string;

    constructor(origin: Partial<AccountRolesRequest>) {
        if (!origin.account_id) throw new Error("account_id is required");
        origin.auth && (this.auth = origin.auth);
        this.account_id = origin.account_id;
    }
    static self(unsafe: AccountRolesRequest) {
        return new AccountRolesRequest(unsafe);
    }
}

export class AccountRolesResponse implements BaseResponse<RoleDTO> {
    public success: boolean;
    public message: string;
    public data: {
        roles: RoleDTO[]
    };

    constructor(origin: AccountRolesResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}