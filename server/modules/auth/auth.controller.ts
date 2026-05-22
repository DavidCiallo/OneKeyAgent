import {
    AliveRequest, AliveResponse,
    LoginRequest, LoginResponse,
    RegisterRequest, RegisterResponse,
    AuthConfigRequest, AuthConfigResponse,
    VerifyEmailRequest, VerifyEmailResponse,
    DailySigninRequest, DailySigninResponse,
} from "../../../shared/modules/auth/auth.interface";
import { AuthRouterInstance } from "../../../shared/modules/auth/auth.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, loginUser, preRegisterUser, completeRegistration, getAccountByEmail, claimDailyBonus } from "./auth.service";
import { SettingsService } from "../settings/settings.service";
import { AccountRoleService } from "../role/role.service";

const ALL_MENUS = ["model", "usage", "account", "profile"];

async function alive(request: AliveRequest): Promise<AliveResponse> {
    request = AliveRequest.self(request);
    const { auth } = request;
    if (auth && getIdentifyByVerify(auth)) {
        const email = getIdentifyByVerify(auth)!;
        const account = await getAccountByEmail(email);
        if (account) {
            const roles = account.is_admin
                ? ALL_MENUS.map(name => ({ name, type: "menu" }))
                : (await AccountRoleService.findByAccount(account.id)).map(r => ({ name: r.name, type: r.type }));
            return new AliveResponse({ success: true, message: "Authorized", data: { is_admin: account.is_admin, roles } });
        }
        return new AliveResponse({ success: true, message: "Authorized", data: { is_admin: 0, roles: [] } });
    } else {
        return new AliveResponse({ success: false, message: "Unauthorized", data: {} });
    }
}

async function login(request: LoginRequest): Promise<LoginResponse> {
    request = LoginRequest.self(request);
    const { identify } = request;
    if (!identify) {
        throw "Authorized failed";
    }
    const { email, password } = request.identify;
    const result = await loginUser(email, password);
    if (!result.token) {
        return new LoginResponse({ success: false, message: "Invalid email or password", data: { token: "" } });
    }
    return new LoginResponse({ success: true, message: "Login success", data: { token: result.token, is_admin: result.is_admin, roles: result.roles } });
}

async function config(_request: AuthConfigRequest): Promise<AuthConfigResponse> {
    const domains = SettingsService.get("allowed_register_domains");
    const allowed_domains = domains ? domains.split(",").map(d => d.trim()).filter(Boolean) : [];
    return new AuthConfigResponse({
        success: true,
        message: "success",
        data: { allowed_domains },
    });
}

async function register(request: RegisterRequest): Promise<RegisterResponse> {
    request = RegisterRequest.self(request);
    const { identify } = request;
    if (!identify) {
        throw "Register data is missing";
    }
    const { name, email, password } = identify;
    const result = await preRegisterUser(name, email, password);
    if (!result.needsVerification) {
        return new RegisterResponse({ success: false, message: "Registration failed, email may already exist", data: { token: "" } });
    }
    return new RegisterResponse({ success: true, message: "Verification email sent", data: { token: "", needs_verification: true } });
}

async function verify(request: VerifyEmailRequest): Promise<VerifyEmailResponse> {
    request = VerifyEmailRequest.self(request);
    const { token } = request;
    if (!token) {
        return new VerifyEmailResponse({ success: false, message: "Verification token is required", data: {} });
    }
    const result = await completeRegistration(token);
    console.log(token, result);
    if (!result) {
        return new VerifyEmailResponse({ success: false, message: "Invalid or expired verification link, or email already registered", data: {} });
    }
    return new VerifyEmailResponse({ success: true, message: "Registration completed! You can now log in.", data: {} });
}

async function dailySignin(request: DailySigninRequest): Promise<DailySigninResponse> {
    request = DailySigninRequest.self(request);
    const email = getIdentifyByVerify(request.auth || "");
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account) throw "Account not found";

    const amount = await claimDailyBonus(account.id);
    if (amount === 0) {
        return new DailySigninResponse({ success: true, message: "Already claimed today", data: { amount: 0 } });
    }
    return new DailySigninResponse({ success: true, message: "Daily bonus claimed", data: { amount } });
}

export const authController = new AuthRouterInstance(inject, { alive, login, register, config, verify, daily: dailySignin });