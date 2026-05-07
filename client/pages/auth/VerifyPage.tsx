"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { AuthRouter } from "../../api/instance";
import { VerifyEmailRequest } from "../../../shared/modules/auth/auth.interface";
import { Locale } from "../../methods/locale";
import NeuralLogo from "../home/components/NeuralLogo";

export default function VerifyEmailPage() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const locale = Locale("AuthPage");
    const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
    const [message, setMessage] = useState("");

    useEffect(() => {
        const token = searchParams.get("token");
        if (!token) {
            setStatus("error");
            setMessage("Invalid verification link");
            return;
        }
        AuthRouter.verify(new VerifyEmailRequest({ token })).then(res => {
            if (res.success) {
                setStatus("success");
                setMessage(res.message || "Registration completed!");
            } else {
                setStatus("error");
                setMessage(res.message || "Verification failed");
            }
        }).catch(() => {
            setStatus("error");
            setMessage("Verification failed, please try again");
        });
    }, []);

    return (
        <div className="flex min-h-full w-full items-center justify-center bg-gradient-to-b from-gray-50 to-white">
            <div className="flex w-full flex-col items-center px-4 sm:px-6 md:max-w-lg lg:max-w-xl" style={{ margin: "auto" }}>
                <div className="flex flex-col items-center mb-8 mt-16 md:mt-20">
                    <NeuralLogo className="w-14 h-14 sm:w-16 sm:h-16 text-primary mb-4" />
                </div>
                <div className="w-full rounded-2xl border border-gray-200 bg-white px-5 py-9 sm:px-8 sm:py-9 shadow-sm text-center">
                    {status === "verifying" && (
                        <>
                            <div className="text-4xl mb-4">⏳</div>
                            <h2 className="text-lg font-semibold text-gray-900 mb-2">{locale.VerifyEmailVerifying}</h2>
                        </>
                    )}
                    {status === "success" && (
                        <>
                            <div className="text-4xl mb-4">✅</div>
                            <h2 className="text-lg font-semibold text-gray-900 mb-2">{locale.VerifySuccess}</h2>
                            <p className="text-sm text-gray-500 mb-6">{message}</p>
                            <button
                                className="w-full px-4 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90"
                                onClick={() => navigate("/auth")}
                            >
                                {locale.BackToLogin}
                            </button>
                        </>
                    )}
                    {status === "error" && (
                        <>
                            <div className="text-4xl mb-4">❌</div>
                            <h2 className="text-lg font-semibold text-gray-900 mb-2">{locale.VerifyFailed}</h2>
                            <p className="text-sm text-gray-500 mb-6">{message}</p>
                            <button
                                className="w-full px-4 py-2.5 bg-primary text-white rounded-lg font-medium hover:opacity-90"
                                onClick={() => navigate("/auth")}
                            >
                                {locale.BackToLogin}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}