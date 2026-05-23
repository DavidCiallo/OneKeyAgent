import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Header } from "../../components/header/Header";
import { Locale } from "../../methods/locale";
import { useAuth } from "../../methods/auth-context";
import { authApi } from "../../api/instance";
import { setUserInfo } from "../../methods/auth";

export default function NoContentPage() {
    const locale = Locale("NoContentPage");
    const navigate = useNavigate();
    const { setAuthInfo } = useAuth();

    useEffect(() => {
        authApi.alive({}).then(({ success, data }) => {
            if (success && data) {
                setUserInfo({ email: localStorage.getItem("user_email") || "", is_admin: data.is_admin, roles: data.roles });
                setAuthInfo({ is_admin: data.is_admin, roles: data.roles });
                const firstMenu = data.is_admin
                    ? "model"
                    : data.roles?.find(r => r.type === "menu")?.name;
                if (firstMenu) {
                    navigate(`/${firstMenu}`, { replace: true });
                }
            }
        });
    }, []);

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={locale.Title} />
            <div className="flex flex-1 items-center justify-center">
                <p className="text-gray-400 text-lg">{locale.Message}</p>
            </div>
        </div>
    );
}