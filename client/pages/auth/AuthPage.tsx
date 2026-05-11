"use client";

import { useState, useEffect } from "react";
import { Button, Input, Form, Select, SelectItem } from "@heroui/react";
import { AuthRouter } from "../../api/instance";
import { useNavigate } from "react-router-dom";
import { toast } from "../../methods/notify";
import { setAuthStatus, setUserInfo } from "../../methods/auth";
import { Locale } from "../../methods/locale";
import { useAuth } from "../../methods/auth-context";
import { LoginBody, LoginRequest, RegisterBody, RegisterRequest, AuthConfigRequest } from "../../../shared/modules/auth/auth.interface";
import NeuralLogo from "../home/components/NeuralLogo";

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
    const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
    const [registeredEmail, setRegisteredEmail] = useState<string>("");
    const [emailDomain, setEmailDomain] = useState<string>("gmail.com");
    const [emailLocal, setEmailLocal] = useState<string>("");

    useEffect(() => {
        AuthRouter.config(new AuthConfigRequest()).then(res => {
            if (res.success && res.data?.allowed_domains?.length > 0) {
                setAllowedDomains(res.data.allowed_domains);
                setEmailDomain(res.data.allowed_domains[0]);
            }
        });
    }, []);

    const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const { email, password } = Object.fromEntries(new FormData(event.currentTarget) as unknown as Iterable<[string, string]>);
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
        const { name, password } = Object.fromEntries(new FormData(event.currentTarget) as unknown as Iterable<[string, string]>);
        const emailStr = `${emailLocal}@${emailDomain}`;
        const { success, data, message } = await AuthRouter.register(new RegisterRequest({
            identify: new RegisterBody({
                name: name.toString(),
                email: emailStr,
                password: password.toString(),
            })
        }));
        if (!success || !data) {
            toast({ title: message || locale.RegisterFailed, color: "danger" });
            return;
        }
        if (data.needs_verification) {
            setRegisteredEmail(emailStr);
            return;
        }
        toast({ title: locale.RegisterSuccess, color: "success" });
        // Auto-login after register (admin/skip-verification flow)
        setAuthStatus({ access_token: data.token, expires_in: 60 * 60 * 24 * 3 });
        setUserInfo({ email: emailStr, is_admin: data.is_admin, roles: data.roles });
        setAuthInfo({ is_admin: data.is_admin, roles: data.roles });
        navigate(getDefaultRoute(data.is_admin, data.roles));
    };

    return (
        <div className="flex min-h-full w-full items-center justify-center bg-gradient-to-b from-gray-50 to-white">
            <div className="flex w-full flex-col items-center px-4 sm:px-6 md:max-w-lg lg:max-w-xl" style={{ margin: "auto" }}>
                {/* Brand */}
                <div className="flex flex-col items-center mb-8 mt-16 md:mt-20">
                    <NeuralLogo className="w-14 h-14 sm:w-16 sm:h-16 text-primary mb-4" />
                    <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 tracking-tight">{locale.Title}</h1>
                </div>
                {registeredEmail ? (
                    /* Verification email sent state */
                    <div className="w-full rounded-2xl border border-gray-200 bg-white px-5 py-9 sm:px-8 sm:py-9 shadow-sm text-center">
                        <div className="text-4xl mb-4">📧</div>
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">{locale.VerifyEmailTitle}</h2>
                        <p className="text-sm text-gray-500 mb-1">{locale.VerifyEmailSent}</p>
                        <p className="text-sm font-medium text-gray-700 mb-6">{registeredEmail}</p>
                        <p className="text-xs text-gray-400 mb-6">{locale.VerifyEmailCheckSpam}</p>
                        <Button className="w-full" color="primary" variant="flat" size="lg" onClick={() => location.reload()}>
                            {locale.BackToLogin}
                        </Button>
                    </div>
                ) : (
                    <div className="w-full rounded-2xl border border-gray-200 bg-white px-5 py-7 sm:px-8 sm:py-9 shadow-sm">
                        {isRegister ? (
                            <Form key="register" className="flex flex-col gap-5" validationBehavior="native" onSubmit={handleRegister} autoComplete="off">
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
                                    type="text"
                                    variant="bordered"
                                    autoComplete="off"
                                    value={emailLocal}
                                    onValueChange={(val) => setEmailLocal(val.replace(/[^a-zA-Z0-9._-]/g, ""))}
                                    errorMessage={() => locale.EmailError}
                                    endContent={
                                        <div className="flex items-center">
                                            <span className="text-default-400 text-sm">@</span>
                                            <Select
                                                aria-label="Email domain"
                                                classNames={{
                                                    base: "w-32",
                                                    trigger: "min-h-unit-7 h-7 bg-transparent shadow-none border-none",
                                                    popoverContent: "min-w-[120px]",
                                                    innerWrapper: "pt-0",
                                                }}
                                                disallowEmptySelection
                                                selectedKeys={[emailDomain]}
                                                variant="bordered"
                                                onSelectionChange={(keys) => {
                                                    const v = Array.from(keys)[0];
                                                    if (v) setEmailDomain(v.toString());
                                                }}
                                            >
                                                {(allowedDomains.length > 0 ? allowedDomains : ["gmail.com"]).map((d) => (
                                                    <SelectItem key={d}>{d}</SelectItem>
                                                ))}
                                            </Select>
                                        </div>
                                    }
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
                                <Button className="w-full" color="primary" type="submit" size="lg">
                                    {locale.RegisterButtonText}
                                </Button>
                                <div className="flex w-full items-center justify-between gap-1 text-sm text-default-500">
                                    <div className="flex gap-1">
                                        {locale.LoginText}
                                        <span className="text-primary cursor-pointer font-medium" onClick={() => setIsRegister(false)}>
                                            {locale.LoginLink}
                                        </span>
                                    </div>
                                    <span />
                                </div>
                            </Form>
                        ) : (
                            <Form key="login" className="flex flex-col gap-5" validationBehavior="native" onSubmit={handleLogin}>
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
                                <div className="w-full flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex gap-1 text-sm text-default-500">
                                        {locale.RegisterText}
                                        <span className="text-primary cursor-pointer font-medium" onClick={() => setIsRegister(true)}>
                                            {locale.RegisterLink}
                                        </span>
                                    </div>
                                    <div
                                        className="text-default-500 text-sm cursor-pointer hover:text-gray-700"
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
                                <Button className="w-full" color="primary" type="submit" size="lg">
                                    {locale.SubmitButtonText}
                                </Button>
                            </Form>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}