import { BaseRouterInstance } from "../../lib/default/decorator";
import { LoginRequest, LoginResponse, AliveRequest, AliveResponse } from "./auth.interface";

export class AuthRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/auth";
    router = [
        { path: "/login", handler: Function },
        { path: "/alive", handler: Function },
    ];

    login!: (request: LoginRequest) => Promise<LoginResponse>;
    alive!: (request: AliveRequest) => Promise<AliveResponse>;

    constructor(
        inject: Function,
        functions?: {
            login: (request: LoginRequest) => Promise<LoginResponse>;
            alive: (request: AliveRequest) => Promise<AliveResponse>;
        }
    ) {
        super();
        inject(this, functions);
    }
}
