import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { AccountEntity } from "./account.entity";


// DTO 的字段均只来自于实体，不允许添加额外字段
// 额外业务字段（例如查询的page）不允许直接在实体中添加，而应该在请求中添加

// Base DTO
// 只在服务端使用，用于构建安全的返回对象
export class AccountDTO {
    public id: string;
    public name: string;
    public email: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: AccountEntity) {
        this.id = origin.id;
        this.name = origin.name;
        this.email = origin.email;
    }
}

// Client DTO
// throw 仅在构造函数中使用

// 客户端使用，使用new用于构造合法请求，非法请求在本地构建时throw
// 服务端使用，使用self进行重复构造，非法请求会被拒绝throw并且返回错误

export class AccountQueryBody {
    public id?: string;
    public name?: string;
    public email?: string;

    private isTypeSafe: symbol = Symbol();

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

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Pick<AccountEntity, "name" | "email" | "password">) {
        if (!origin.name || !origin.email || !origin.password) {
            throw new Error("Name and email are required");
        }
        this.name = origin.name;
        this.email = origin.email;
        this.password = origin.password;
    }

    static self(unsafe: AccountCreateBody) {
        return new AccountCreateBody(unsafe);
    }
}

export class AccountUpdateBody {
    public name: string;
    public email: string;
    public password: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Partial<AccountEntity> = {}) {
        if (!origin.name && !origin.email && !origin.password) {
            throw new Error("Least one field not null");
        }
        this.name = origin.name || "";
        this.email = origin.email || "";
        this.password = origin.password || "";
    }

    static self(unsafe: AccountUpdateBody) {
        return new AccountUpdateBody(unsafe);
    }
}

// Interface
// throw 仅在构造函数中使用

// 客户端使用，使用new用于构造合法请求，非法请求在本地构建时throw
// 服务端使用，使用self进行重复构造，非法请求会被拒绝throw并且返回错误

// 来自客户端的请求，使用同框架client发送的，已经在构建时就检验了
// 但服务端仍需要在每个请求开头进行检查，以防第三方请求非法

// 服务端的返回可以保证符合接口声明，无需额外检验

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