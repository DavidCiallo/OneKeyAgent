import { BaseRouterInstance } from "../../lib/default/decorator";
import { LoginRequest, LoginResponse, AliveRequest, AliveResponse, RegisterRequest, RegisterResponse, AuthConfigRequest, AuthConfigResponse, VerifyEmailRequest, VerifyEmailResponse } from "./auth.interface";

export class AuthRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/auth";
    router = [
        { path: "/login", handler: Function },
        { path: "/alive", handler: Function },
        { path: "/register", handler: Function },
        { path: "/config", handler: Function },
        { path: "/verify", handler: Function },
    ];

    login!: (request: LoginRequest) => Promise<LoginResponse>;
    alive!: (request: AliveRequest) => Promise<AliveResponse>;
    register!: (request: RegisterRequest) => Promise<RegisterResponse>;
    config!: (request: AuthConfigRequest) => Promise<AuthConfigResponse>;
    verify!: (request: VerifyEmailRequest) => Promise<VerifyEmailResponse>;

    constructor(
        inject: Function,
        functions?: {
            login: (request: LoginRequest) => Promise<LoginResponse>;
            alive: (request: AliveRequest) => Promise<AliveResponse>;
            register: (request: RegisterRequest) => Promise<RegisterResponse>;
            config: (request: AuthConfigRequest) => Promise<AuthConfigResponse>;
            verify: (request: VerifyEmailRequest) => Promise<VerifyEmailResponse>;
        }
    ) {
        super();
        inject(this, functions);
    }
}
