import { AliveRequest, AliveResponse, LoginRequest, LoginResponse, } from "../../../shared/modules/auth/auth.interface";
import { AuthRouterInstance } from "../../../shared/modules/auth/auth.router";
import { inject } from "../../lib/inject";
import { getIdentifyByVerify, loginUser } from "./auth.service";

async function alive(request: AliveRequest): Promise<AliveResponse> {
    request = AliveRequest.self(request);
    const { auth } = request;
    if (auth && getIdentifyByVerify(auth)) {
        return new AliveResponse({ success: true, message: "Authorized" });
    } else {
        return new AliveResponse({ success: false, message: "Unauthorized" });
    }
}

async function login(request: LoginRequest): Promise<LoginResponse> {
    request = LoginRequest.self(request);
    const { identify } = request;
    if (!identify) {
        throw "Authorized failed";
    }
    const { email, password } = request.identify;
    const { token } = await loginUser(email, password);
    if (!token) {
        return new LoginResponse({ success: false, message: "账号或密码错误", data: { token: "" } });
    }
    return new LoginResponse({ success: true, message: "Login success", data: { token } });
}

export const authController = new AuthRouterInstance(inject, { alive, login });
