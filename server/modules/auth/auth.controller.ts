import {
    AliveRequest, AliveResponse,
    LoginRequest, LoginResponse,
    RegisterRequest, RegisterResponse
} from "../../../shared/modules/auth/auth.interface";
import { AuthRouterInstance } from "../../../shared/modules/auth/auth.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, loginUser, registerUser, getAccountByEmail } from "./auth.service";
import { AccountRoleService } from "../role/role.service";

const ALL_MENUS = ["chat", "model", "usage", "account", "profile"];

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
    const { token, is_admin, roles } = await loginUser(email, password);
    if (!token) {
        return new LoginResponse({ success: false, message: "账号或密码错误", data: { token: "" } });
    }
    return new LoginResponse({ success: true, message: "Login success", data: { token, is_admin, roles } });
}

async function register(request: RegisterRequest): Promise<RegisterResponse> {
    request = RegisterRequest.self(request);
    const { identify } = request;
    if (!identify) {
        throw "Register data is missing";
    }
    const { name, email, password } = identify;
    const { account } = await registerUser(name, email, password);
    if (!account) {
        return new RegisterResponse({ success: false, message: "注册失败，可能邮箱已存在", data: { token: "" } });
    }
    // Auto-login after register
    const { token, is_admin, roles } = await loginUser(email, identify.password);
    return new RegisterResponse({ success: true, message: "注册成功", data: { token: token || "", is_admin, roles } });
}

export const authController = new AuthRouterInstance(inject, { alive, login, register });