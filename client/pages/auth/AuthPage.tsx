"use client";

import { Button, Input, Form } from "@heroui/react";
import { AuthRouter } from "../../api/instance";
import { useNavigate } from "react-router-dom";
import { toast } from "../../methods/notify";
import { setAuthStatus, setUserInfo } from "../../methods/auth";
import { Locale } from "../../methods/locale";
import { useAuth } from "../../methods/auth-context";
import { LoginBody, LoginRequest } from "../../../shared/modules/auth/auth.interface";

function getDefaultRoute(is_admin?: number, roles?: { name: string; type: string }[]): string {
    if (is_admin) return "/chat";
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

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
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

    return (
        <div className="flex h-full w-full items-center justify-center">
            <div className="rounded-large flex w-full max-w-sm flex-col gap-4 px-8 pt-[20vh]">
                <p className="pb-4 text-left text-3xl font-semibold">
                    <span aria-label="emoji" className="mr-4" role="img">
                        📖
                    </span>
                    {locale.Title}
                </p>
                <Form className="flex flex-col gap-4" validationBehavior="native" onSubmit={handleSubmit}>
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
                    <div className="flex w-full items-center justify-end">
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
            </div>
        </div>
    );
}
