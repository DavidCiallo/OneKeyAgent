"use client";

import { useState } from "react";
import { Button, Input, Form } from "@heroui/react";
import { AuthRouter } from "../../api/instance";
import { useNavigate } from "react-router-dom";
import { toast } from "../../methods/notify";
import { setAuthStatus, setUserInfo } from "../../methods/auth";
import { Locale } from "../../methods/locale";
import { useAuth } from "../../methods/auth-context";
import { LoginBody, LoginRequest, RegisterBody, RegisterRequest } from "../../../shared/modules/auth/auth.interface";

function getDefaultRoute(is_admin?: number, roles?: { name: string; type: string }[]): string {
    if (is_admin) return "/profile";
    if (roles && roles.length > 0) {
        const menuRole = roles.find(r => r.type === "menu");
        if (menuRole) return `/${menuRole.name}`;
    }
    return "/nocontent";
}

export default function Component() {
    const navigate = useNavigate();
    const locale = Locale("AuthPage");
    const { setAuthInfo } = useAuth();
    const [isRegister, setIsRegister] = useState(false);

    const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const { email, password } = Object.fromEntries(new FormData(event.currentTarget));
        const { success, data, message } = await AuthRouter.login(new LoginRequest({
            identify: new LoginBody({
                email: email.toString(),
                password: password.toString(),
            })
        }));
        if (!success || !data) {
            toast({ title: message || locale.LoginFailed, color: "danger" });
            return;
        }
        const { token } = data;
        toast({ title: locale.LoginSuccess, color: "success" });
        await new Promise((r) => setTimeout(r, 1000));
        setAuthStatus({ access_token: token, expires_in: 60 * 60 * 24 * 3 });
        setUserInfo({ email: email.toString(), is_admin: data!.is_admin, roles: data!.roles });
        setAuthInfo({ is_admin: data!.is_admin, roles: data!.roles });
        navigate(getDefaultRoute(data!.is_admin, data!.roles));
    };

    const handleRegister = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const { name, email, password } = Object.fromEntries(new FormData(event.currentTarget));
        const { success, data, message } = await AuthRouter.register(new RegisterRequest({
            identify: new RegisterBody({
                name: name.toString(),
                email: email.toString(),
                password: password.toString(),
            })
        }));
        if (!success || !data) {
            toast({ title: message || locale.RegisterFailed, color: "danger" });
            return;
        }
        toast({ title: locale.RegisterSuccess, color: "success" });
        // Auto-login after register
        setAuthStatus({ access_token: data.token, expires_in: 60 * 60 * 24 * 3 });
        setUserInfo({ email: email.toString(), is_admin: data.is_admin, roles: data.roles });
        setAuthInfo({ is_admin: data.is_admin, roles: data.roles });
        navigate(getDefaultRoute(data.is_admin, data.roles));
    };

    return (
        <div className="flex h-full w-full items-center justify-center">
            <div className="rounded-large flex w-full max-w-sm flex-col gap-4 px-8 pt-[20vh]">
                <p className="pb-4 text-left text-3xl font-semibold flex items-center gap-3">
                    <span className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-base font-bold text-white">H</span>
                    {locale.Title}
                </p>
                {isRegister ? (
                    <Form className="flex flex-col gap-4" validationBehavior="native" onSubmit={handleRegister} autoComplete="off">
                        <Input
                            isRequired
                            label={locale.NameLabel}
                            labelPlacement="outside"
                            name="name"
                            placeholder={locale.NamePlaceholder}
                            variant="bordered"
                            autoComplete="off"
                            errorMessage={() => locale.NameError}
                        />
                        <Input
                            isRequired
                            label={locale.EmailLabel}
                            labelPlacement="outside"
                            name="email"
                            placeholder={locale.EmailPlaceholder}
                            type="email"
                            variant="bordered"
                            autoComplete="off"
                            errorMessage={() => locale.EmailError}
                        />
                        <Input
                            isRequired
                            label={locale.PasswordLabel}
                            labelPlacement="outside"
                            name="password"
                            placeholder={locale.PasswordPlaceholder}
                            type="password"
                            variant="bordered"
                            autoComplete="new-password"
                            errorMessage={() => locale.PasswordError}
                        />
                        <Button className="w-full" color="primary" type="submit">
                            {locale.RegisterButtonText}
                        </Button>
                        <div className="flex w-full items-center justify-center gap-1 text-sm text-default-500">
                            {locale.LoginText}
                            <span className="text-primary cursor-pointer" onClick={() => setIsRegister(false)}>
                                {locale.LoginLink}
                            </span>
                        </div>
                    </Form>
                ) : (
                    <Form className="flex flex-col gap-4" validationBehavior="native" onSubmit={handleLogin}>
                        <Input
                            isRequired
                            label={locale.EmailLabel}
                            labelPlacement="outside"
                            name="email"
                            placeholder={locale.EmailPlaceholder}
                            type="email"
                            variant="bordered"
                            errorMessage={() => locale.EmailError}
                        />
                        <Input
                            isRequired
                            label={locale.PasswordLabel}
                            labelPlacement="outside"
                            name="password"
                            placeholder={locale.PasswordPlaceholder}
                            type="password"
                            variant="bordered"
                            errorMessage={() => locale.PasswordError}
                        />
                        <div className="flex w-full items-center justify-between">
                            <div className="flex text-left gap-1 text-sm text-default-500">
                                {locale.RegisterText}
                                <span className="text-primary cursor-pointer" onClick={() => setIsRegister(true)}>
                                    {locale.RegisterLink}
                                </span>
                            </div>
                            <div
                                className="text-default-500 text-sm cursor-pointer"
                                onClick={() =>
                                    toast({
                                        title: locale.ForgetPasswordErrorText,
                                        color: "danger",
                                    })
                                }
                            >
                                {locale.ForgetPasswordLinkText}
                            </div>
                        </div>
                        <Button className="w-full" color="primary" type="submit">
                            {locale.SubmitButtonText}
                        </Button>

                    </Form>
                )}
            </div>
        </div>
    );
}