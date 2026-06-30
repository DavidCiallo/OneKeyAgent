import {
    AliveRequest, AliveResponse,
    LoginRequest, LoginResponse,
    RegisterRequest, RegisterResponse,
    AuthConfigRequest, AuthConfigResponse,
    VerifyEmailRequest, VerifyEmailResponse,
    DailySigninRequest, DailySigninResponse,
} from "../../../shared/modules/auth/auth.interface";
import { authRoutes } from "../../../shared/modules/auth/auth.router";
import { getIdentifyByVerify, loginUser, preRegisterUser, completeRegistration, getAccountByEmail, claimDailyBonus } from "./auth.service";
import { SettingsService } from "../settings/settings.service";
import { AccountRoleService } from "../role/role.service";

const ALL_MENUS = ["model", "usage", "account", "profile"];

async function alive(request: AliveRequest) {
    request = AliveRequest.self(request);
    const { auth } = request;
    if (auth && getIdentifyByVerify(auth)) {
        const email = getIdentifyByVerify(auth)!;
        const account = await getAccountByEmail(email);
        if (account) {
            const roles = account.is_admin
                ? ALL_MENUS.map(name => ({ name, type: "menu" }))
                : (await AccountRoleService.findByAccount(account.id)).map(r => ({ name: r.name, type: r.type }));
            return { is_admin: account.is_admin, roles };
        }
        return { is_admin: 0, roles: [] };
    } else {
        throw "Unauthorized";
    }
}

async function login(request: LoginRequest) {
    request = LoginRequest.self(request);
    const { identify } = request;
    if (!identify) throw "Authorized failed";
    const { email, password } = request.identify;
    const result = await loginUser(email, password);
    if (!result.token) throw "Invalid email or password";
    return { token: result.token, is_admin: result.is_admin, roles: result.roles };
}

async function config(_request: AuthConfigRequest) {
    const domains = SettingsService.get("allowed_register_domains");
    const allowed_domains = domains ? domains.split(",").map(d => d.trim()).filter(Boolean) : [];
    const enable_recharge = SettingsService.get("enable_recharge") !== "false";
    return { allowed_domains, enable_recharge };
}

async function register(request: RegisterRequest) {
    request = RegisterRequest.self(request);
    const { identify } = request;
    if (!identify) throw "Register data is missing";
    const { name, email, password } = identify;
    const result = await preRegisterUser(name, email, password);
    if (!result.needsVerification) throw "Registration failed, email may already exist";
    return { token: "", needs_verification: true };
}

async function verify(request: VerifyEmailRequest) {
    request = VerifyEmailRequest.self(request);
    const { token } = request;
    if (!token) throw "Verification token is required";
    const result = await completeRegistration(token);
    console.log(token, result);
    if (!result) throw "Invalid or expired verification link, or email already registered";
    return {};
}

async function dailySignin(request: DailySigninRequest) {
    request = DailySigninRequest.self(request);
    const email = getIdentifyByVerify(request.auth || "");
    if (!email) throw "Authorization failed";
    const account = await getAccountByEmail(email);
    if (!account) throw "Account not found";

    const amount = await claimDailyBonus(account.id);
    if (amount === 0) return { amount: 0 };
    return { amount };
}

export const authMount = {
    routes: authRoutes,
    handlers: { alive, login, register, config, verify, daily: dailySignin },
};
