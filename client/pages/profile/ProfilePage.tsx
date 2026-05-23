import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { accountApi, aiApi, authApi } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { AccountDTO } from "../../../shared/modules/account/account.interface";
import AccountInfoCard from "./components/AccountInfoCard";
import ApiKeyCard from "./components/ApiKeyCard";
import ModelsCard from "./components/ModelsCard";
import RegenerateModal from "./components/RegenerateModal";
import { useDisclosure } from "@heroui/react";

export default function ProfilePage() {
    const menuLocale = Locale("Menu");

    const [account, setAccount] = useState<AccountDTO | null>(null);
    const [balance, setBalance] = useState(0);
    const [weeklyUsage, setWeeklyUsage] = useState(0);
    const [models, setModels] = useState<{ id: string; input_price: number; output_price: number }[]>([]);
    const [regenerating, setRegenerating] = useState(false);
    const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose, onOpenChange: onConfirmChange } = useDisclosure();

    const fetchProfile = useCallback(async () => {
        const res = await accountApi.profile({} as any);
        if (res.success && res.data?.account) {
            setAccount(res.data.account);
            setBalance(res.data.balance ?? 0);
            setWeeklyUsage(res.data.weeklyUsage ?? 0);
        }
    }, []);

    const fetchModels = useCallback(async () => {
        const res = await aiApi.models({} as any);
        if (res.success && res.data) {
            const allModels = res.data.map((m: any) => ({ id: m.id, input_price: m.input_price, output_price: m.output_price }));
            setModels(allModels);
        }
    }, []);

    // Auto daily sign-in
    const tryDailySignin = useCallback(async () => {
        const signDate = localStorage.getItem("sign_date");
        const today = new Date().toDateString();
        if (signDate === today) return;
        const res = await authApi.daily({} as any);
        if (res.success && res.data?.amount && res.data.amount > 0) {
            localStorage.setItem("sign_date", today);
            fetchProfile();
        }
    }, []);

    useEffect(() => {
        fetchProfile();
        fetchModels();
    }, [fetchProfile, fetchModels]);

    useEffect(() => {
        tryDailySignin();
    }, [tryDailySignin]);

    const handleRegenerate = async () => {
        onConfirmClose();
        setRegenerating(true);
        try {
            const res = await accountApi.regenerate({} as any);
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
                    <AccountInfoCard account={account} weeklyUsage={weeklyUsage} balance={balance} />
                    <ApiKeyCard
                        api_key={account.api_key}
                        regenerating={regenerating}
                        onConfirmOpen={onConfirmOpen}
                        endpoint={endpoint}
                        onCopy={handleCopy}
                    />
                    <ModelsCard models={models} />
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