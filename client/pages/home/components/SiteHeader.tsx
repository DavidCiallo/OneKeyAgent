import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@heroui/react";
import { AuthStatus } from "../../../methods/auth";

export default function SiteHeader({
    auth,
    locale,
}: {
    auth: AuthStatus;
    locale: { [key: string]: string };
}) {
    const lanMap: Record<string, string> = {
        cn: "ZH",
        en: "EN",
        ru: "RU",
        ja: "JA",
        es: "ES",
        "pt-BR": "PT",
        vi: "VI",
        th: "TH",
    };

    const currentLan = localStorage.getItem("locale") || "en";

    const handleSelect = (key: string) => {
        localStorage.setItem("locale", key);
        window.location.reload();
    };

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
                    <Dropdown>
                        <DropdownTrigger>
                            <Button size="sm" variant="bordered" className="text-xs text-gray-500 w-16">
                                {lanMap[currentLan] || "EN"}
                            </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                            selectedKeys={new Set([currentLan])}
                            selectionMode="single"
                            onAction={(key) => handleSelect(key as string)}
                        >
                            {Object.entries(lanMap).map(([key, label]) => (
                                <DropdownItem key={key}>{label}</DropdownItem>
                            ))}
                        </DropdownMenu>
                    </Dropdown>
                </div>
            </nav>
        </header>
    );
}
