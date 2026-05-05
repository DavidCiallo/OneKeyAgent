import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { AccountRouter, AiRouter, UsageRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { AccountProfileRequest, AccountRegenerateRequest } from "../../../shared/modules/account/account.interface";
import { ModelsRequest } from "../../../shared/modules/ai/ai.interface";
import { MyUsageRequest } from "../../../shared/modules/usage/usage.interface";
import { AccountDTO } from "../../../shared/modules/account/account.interface";
import AccountInfoCard from "./components/AccountInfoCard";
import ApiKeyCard from "./components/ApiKeyCard";
import EndpointCard from "./components/EndpointCard";
import RegenerateModal from "./components/RegenerateModal";
import { useDisclosure } from "@heroui/react";

export default function ProfilePage() {
    const menuLocale = Locale("Menu");
    const getToken = () => localStorage.getItem("access_token") || "";

    const [account, setAccount] = useState<AccountDTO | null>(null);
    const [models, setModels] = useState<string[]>([]);
    const [regenerating, setRegenerating] = useState(false);
    const [usage, setUsage] = useState<{ today: number; thisWeek: number; total: number } | null>(null);
    const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose, onOpenChange: onConfirmChange } = useDisclosure();

    const fetchProfile = useCallback(async () => {
        const res = await AccountRouter.profile(new AccountProfileRequest({ auth: getToken() }));
        if (res.success && res.data?.account) {
            setAccount(res.data.account);
        }
    }, []);

    const fetchModels = useCallback(async () => {
        const res = await AiRouter.models(new ModelsRequest({ auth: getToken() }));
        if (res.success && res.data) {
            const allIds = res.data.map((m: any) => m.id);
            setModels(allIds);
        }
    }, []);

    const fetchUsage = useCallback(async () => {
        const res = await UsageRouter.mystats(new MyUsageRequest({ auth: getToken() }));
        if (res.success && res.data) {
            setUsage(res.data);
        }
    }, []);

    useEffect(() => {
        fetchProfile();
        fetchModels();
        fetchUsage();
    }, [fetchProfile, fetchModels, fetchUsage]);

    const handleRegenerate = async () => {
        onConfirmClose();
        setRegenerating(true);
        try {
            const res = await AccountRouter.regenerate(new AccountRegenerateRequest({ auth: getToken() }));
            if (res.success && res.data) {
                await fetchProfile();
            }
        } finally {
            setRegenerating(false);
        }
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const endpoint = `${window.location.origin}/api`;

    if (!account) return null;

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={menuLocale.Profile} />
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-2xl mx-auto space-y-6">
                    <AccountInfoCard account={account} usage={usage} />
                    <ApiKeyCard
                        apiKey={account.apiKey}
                        onRegenerate={handleRegenerate}
                        regenerating={regenerating}
                        onConfirmOpen={onConfirmOpen}
                    />
                    <EndpointCard endpoint={endpoint} models={models} onCopy={handleCopy} />
                </div>
            </div>

            <RegenerateModal
                isOpen={isConfirmOpen}
                onOpenChange={onConfirmChange}
                onConfirm={handleRegenerate}
                regenerating={regenerating}
            />
        </div>
    );
}
