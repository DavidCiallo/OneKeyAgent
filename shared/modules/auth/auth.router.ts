import { LoginRequest, LoginResponse, AliveRequest, AliveResponse, RegisterRequest, RegisterResponse, AuthConfigRequest, AuthConfigResponse, VerifyEmailRequest, VerifyEmailResponse, DailySigninRequest, DailySigninResponse } from "./auth.interface";

export const authRoutes = {
    base: "/api",
    prefix: "/auth",
    login:    { path: "/login",    request: {} as LoginRequest,            response: {} as LoginResponse },
    alive:    { path: "/alive",    request: {} as AliveRequest,            response: {} as AliveResponse },
    register: { path: "/register", request: {} as RegisterRequest,         response: {} as RegisterResponse },
    config:   { path: "/config",   request: {} as AuthConfigRequest,       response: {} as AuthConfigResponse },
    verify:   { path: "/verify",   request: {} as VerifyEmailRequest,      response: {} as VerifyEmailResponse },
    daily:    { path: "/daily",    request: {} as DailySigninRequest,       response: {} as DailySigninResponse },
} as const;
