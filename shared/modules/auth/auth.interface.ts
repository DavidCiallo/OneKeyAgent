import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { AccountEntity } from "../account/account.entity";

// Auth Body
// 用于封装登录和注册请求的具体数据

export class LoginBody {
    public email: string;
    public password: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: Pick<AccountEntity, "email" | "password">) {
        if (!origin.email || !origin.password) {
            throw new Error("Email and password are required");
        }
        this.email = origin.email;
        this.password = origin.password;
    }

    static self(unsafe: LoginBody) {
        return new LoginBody(unsafe);
    }
}

// Interface
// 遵循 account.interface.ts 的 Request/Response 模式

export class RegisterBody {
    public name: string;
    public email: string;
    public password: string;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: any) {
        if (!origin.name || !origin.email || !origin.password) {
            throw new Error("Name, email and password are required");
        }
        this.name = origin.name;
        this.email = origin.email;
        this.password = origin.password;
    }

    static self(unsafe: RegisterBody) {
        return new RegisterBody(unsafe);
    }
}

export class RegisterRequest implements BaseRequest {
    public auth?: string;
    public identify: RegisterBody;

    constructor(origin: Partial<RegisterRequest>) {
        if (!origin.identify) throw new Error("Register data is required");
        this.identify = RegisterBody.self(origin.identify);
    }
    static self(unsafe: RegisterRequest) {
        return new RegisterRequest(unsafe);
    }
}

export class RegisterResponse implements BaseResponse<{ apiKey: string }> {
    public success: boolean;
    public message: string;
    public data: {
        apiKey: string;
    };

    constructor(origin: RegisterResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class LoginRequest implements BaseRequest {
    public auth?: string;
    public identify: LoginBody;

    constructor(origin: Partial<LoginRequest>) {
        if (!origin.identify) throw new Error("Login data is required");
        origin.auth && (this.auth = origin.auth);
        this.identify = LoginBody.self(origin.identify);
    }

    static self(unsafe: LoginRequest) {
        return new LoginRequest(unsafe);
    }
}

export class LoginResponse implements BaseResponse<{ token: string; is_admin?: number; roles?: { name: string; type: string }[] }> {
    public success: boolean;
    public message: string;
    public data: {
        token: string;
        is_admin?: number;
        roles?: { name: string; type: string }[];
    };

    constructor(origin: LoginResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

export class AliveRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<AliveRequest>) {
        this.auth = origin.auth;
    }

    static self(unsafe: AliveRequest) {
        return new AliveRequest(unsafe);
    }
}

export class AliveResponse implements BaseResponse<{ is_admin?: number; roles?: { name: string; type: string }[] }> {
    public success: boolean;
    public message: string;
    public data: { is_admin?: number; roles?: { name: string; type: string }[] };

    constructor(origin: AliveResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}
