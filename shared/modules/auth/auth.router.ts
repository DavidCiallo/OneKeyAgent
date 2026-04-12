import { BaseRouterInstance } from "../../lib/default/decorator";
import { LoginRequest, LoginResponse, AliveRequest, AliveResponse, RegisterRequest, RegisterResponse } from "./auth.interface";

export class AuthRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/auth";
    router = [
        { path: "/login", handler: Function },
        { path: "/alive", handler: Function },
        { path: "/register", handler: Function },
    ];

    login!: (request: LoginRequest) => Promise<LoginResponse>;
    alive!: (request: AliveRequest) => Promise<AliveResponse>;
    register!: (request: RegisterRequest) => Promise<RegisterResponse>;

    constructor(
        inject: Function,
        functions?: {
            login: (request: LoginRequest) => Promise<LoginResponse>;
            alive: (request: AliveRequest) => Promise<AliveResponse>;
            register: (request: RegisterRequest) => Promise<RegisterResponse>;
        }
    ) {
        super();
        inject(this, functions);
    }
}
