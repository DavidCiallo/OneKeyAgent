import { Button } from "@heroui/react";
import { AuthStatus } from "../../../methods/auth";
import NeuralLogo from "./NeuralLogo";

export default function SiteHeader({
    auth,
    locale,
}: {
    auth: AuthStatus;
    locale: { [key: string]: string };
}) {
    function changeLan() {
        const lanList = ["cn", "en"];
        const locale = localStorage.getItem("locale") || "cn";
        const index = lanList.indexOf(locale);
        const nextIndex = (index + 1) % lanList.length;
        localStorage.setItem("locale", lanList[nextIndex]);
        window.location.reload();
    }

    const currentLan = localStorage.getItem("locale") || "cn";
    const lanLabel = currentLan === "cn" ? "中" : "EN";

    return (
        <header className="fixed top-0 inset-x-0 z-50 transition-all duration-300 bg-white">
            <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4 lg:px-8" aria-label="Global">
                <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-gray-900">EHEX</span>
                </div>
                <div className="flex items-center gap-6">
                    {auth === AuthStatus.AUTH ? (
                        <a href="/model" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
                            {locale.NavConsole}
                        </a>
                    ) : (
                        <a href="/auth" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">
                            {locale.NavSignIn}
                        </a>
                    )}
                    <Button size="sm" variant="bordered" className="text-xs text-gray-500 w-16" onClick={changeLan}>
                        {lanLabel}
                    </Button>
                </div>
            </nav>
        </header>
    );
}
