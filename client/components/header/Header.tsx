import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from "@heroui/react";
import { MenuComp } from "./Menu";

type params = {
    name: string;
};

export const Header = ({ name }: params) => {
    function Language() {
        const locale = localStorage.getItem("locale") || "en";
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

        const handleSelect = (key: string) => {
            localStorage.setItem("locale", key);
            window.location.reload();
        };

        return (
            <Dropdown>
                <DropdownTrigger>
                    <Button size="sm" variant="bordered" className="text-xs text-gray-500 w-16">
                        {lanMap[locale] || "EN"}
                    </Button>
                </DropdownTrigger>
                <DropdownMenu
                    selectedKeys={new Set([locale])}
                    selectionMode="single"
                    onAction={(key) => handleSelect(key as string)}
                >
                    {Object.entries(lanMap).map(([key, label]) => (
                        <DropdownItem key={key}>{label}</DropdownItem>
                    ))}
                </DropdownMenu>
            </Dropdown>
        );
    }
    return (
        <div className="w-full h-15 flex flex-row justify-between items-center border-b-1 border-gray-300">
            <div className="w-4/5 md:w-1/2 flex flex-row justify-start items-center">
                <MenuComp now={name} />
                <span className="ml-5 text-xl font-bold">{name}</span>
            </div>
            <div className="w-24 flex flex-row justify-start items-end">
                <Language />
            </div>
        </div>
    );
};
