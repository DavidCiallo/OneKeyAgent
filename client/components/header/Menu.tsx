import { Drawer, DrawerContent, DrawerHeader, DrawerBody, useDisclosure } from "@heroui/react";

import MenuIcon from "../icons/menu";
import { Link, useNavigate } from "react-router-dom";
import { Locale } from "../../methods/locale";
import { useAuth } from "../../methods/auth-context";
import { clearAuthData } from "../../methods/auth";

const ALL_MENUS = ["profile", "subscription", "model", "provider", "usage", "account"] as const;

export const MenuComp = ({ now }: { now?: string }) => {
    const locale = Locale("Menu");
    const { isOpen, onOpen, onOpenChange } = useDisclosure();
    const { is_admin, roles, resetAuth } = useAuth();
    const navigate = useNavigate();

    const menuMap: Record<string, { name: string; link: string }> = {
        profile: { name: locale.Profile, link: "/profile" },
        subscription: { name: locale.Subscription, link: "/subscription" },
        model: { name: locale.Model, link: "/model" },
        provider: { name: locale.Provider, link: "/provider" },
        usage: { name: locale.Usage, link: "/usage" },
        account: { name: locale.Account, link: "/account" },
        nocontent: { name: locale.NoContent, link: "/nocontent" },
    };

    const menuKeys = is_admin
        ? ALL_MENUS
        : (roles.length > 0
            ? roles.filter(r => r.type === "menu").map(r => r.name)
            : ["nocontent"]);
    const menuList = menuKeys
        .filter((key): key is string => key in menuMap)
        .map(key => menuMap[key]);

    function handleLogout() {
        clearAuthData();
        resetAuth();
        navigate("/auth", { replace: true });
    }

    function renderBody(onClose: Function) {
        const list = menuList.map(({ name, link }) => {
            return (
                <div className="m-2 text-lg text-gray-700 cursor-pointer">
                    <Link to={link} onClick={() => onClose()}>
                        <div className={`mr-1 w-full ${now == name ? "text-primary" : ""}`}>{name}</div>
                    </Link>
                </div>
            );
        });
        return (
            <>
                <DrawerHeader className="flex flex-col gap-1">Menu</DrawerHeader>
                <DrawerBody className="h-screen flex flex-col justify-between">
                    <div className="flex flex-col justify-start items-start">{list}</div>
                    <div className="flex flex-row justify-start items-center h-20">
                        <div className="m-2 text-lg text-red-500 cursor-pointer" onClick={() => { onClose(); handleLogout(); }}>
                            {locale.Logout}
                        </div>
                    </div>
                </DrawerBody>
            </>
        );
    }
    return (
        <>
            <div className="w-15 h-12 flex items-center justify-center cursor-pointer" onClick={onOpen}>
                <MenuIcon />
            </div>
            <Drawer isOpen={isOpen} onOpenChange={onOpenChange} className="rounded-none w-48 md:w-60" placement="left">
                <DrawerContent>{(onClose) => renderBody(onClose)}</DrawerContent>
            </Drawer>
        </>
    );
};
