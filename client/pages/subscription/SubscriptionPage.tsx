import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { accountApi, subscriptionApi, authApi } from "../../api/instance";
import { Locale } from "../../methods/locale";
import CurrentPlanCard from "./components/CurrentPlanCard";
import PlanSelector from "./components/PlanSelector";
import Statement from "./components/Statement";
import TopupPack from "./components/TopupPack";

interface StatementRecord {
    id: string;
    type: "topup" | "bonus" | "gift_card" | "usage";
    amount: number;
    description: string;
    create_time: number;
}

export default function SubscriptionPage() {
    const menuLocale = Locale("Menu");

    const [account, setAccount] = useState<{
        name: string;
        balance?: number;
    } | null>(null);

    const [records, setRecords] = useState<StatementRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [refreshing, setRefreshing] = useState(false);
    const [enableRecharge, setEnableRecharge] = useState(false);

    const fetchProfile = useCallback(async () => {
        const res = await accountApi.profile({});
        if (res.success && res.data?.account) {
            setAccount({ ...res.data.account, balance: res.data.balance });
        }
    }, []);

    const fetchRecords = useCallback(async (p: number) => {
        const res = await subscriptionApi.statement({ page: p });
        if (res.success && res.data) {
            setRecords(res.data.list || []);
            setTotal(res.data.total || 0);
        }
    }, []);

    useEffect(() => {
        authApi.config({}).then(res => {
            if (res.success && res.data) {
                setEnableRecharge(res.data.enable_recharge !== false);
            }
        });
    }, []);

    useEffect(() => {
        fetchProfile();
        fetchRecords(page);
    }, [fetchProfile, fetchRecords, page]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchRecords(page);
        await fetchProfile();
        setRefreshing(false);
    };

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={menuLocale.Subscription || "Subscription"} />
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto space-y-6">
                    <CurrentPlanCard tokens={account?.balance || 0} />

                    <PlanSelector onGiftCardActivated={handleRefresh}>
                        {enableRecharge && <TopupPack onSuccess={handleRefresh} />}
                    </PlanSelector>

                    <Statement records={records} total={total} page={page} onPageChange={setPage} onRefresh={handleRefresh} refreshing={refreshing} />
                </div>
            </div>
        </div>
    );
}
