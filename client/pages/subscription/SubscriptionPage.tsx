import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { AccountRouter, TransactionRouter } from "../../api/instance";
import { AccountProfileRequest } from "../../../shared/modules/account/account.interface";
import { TransactionListRequest } from "../../../shared/modules/subscription_record/subscription_record.interface";
import { Locale } from "../../methods/locale";
import CurrentPlanCard from "./components/CurrentPlanCard";
import PlanSelector from "./components/PlanSelector";
import TransactionHistory from "./components/TransactionHistory";
import TopupPack from "./components/TopupPack";

interface TxRecord {
    id: string;
    txid: string;
    amount: number;
    status: string;
    type: string;
    create_time: number;
}

export default function SubscriptionPage() {
    const menuLocale = Locale("Menu");
    const getToken = () => localStorage.getItem("access_token") || "";

    const [account, setAccount] = useState<{
        name: string;
        balance?: number;
    } | null>(null);

    const [records, setRecords] = useState<TxRecord[]>([]);
    const [refreshing, setRefreshing] = useState(false);

    const fetchProfile = useCallback(async () => {
        const res = await AccountRouter.profile(new AccountProfileRequest({ auth: getToken() }));
        if (res.success && res.data?.account) {
            setAccount({ ...res.data.account, balance: res.data.balance });
        }
    }, []);

    const fetchRecords = useCallback(async () => {
        const res = await TransactionRouter.records(new TransactionListRequest({ auth: getToken() }));
        if (res.success && res.data) {
            setRecords(res.data.list?.filter(r => r.status !== "expired" || Date.now() - r.create_time < 6 * 60 * 60 * 1000));
        }
    }, []);

    useEffect(() => {
        fetchProfile();
        fetchRecords();
    }, [fetchProfile, fetchRecords]);

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchRecords();
        await fetchProfile();
        setRefreshing(false);
    };

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={menuLocale.Subscription || "Subscription"} />
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto space-y-6">
                    {account && (
                        <CurrentPlanCard tokens={account.balance || 0} />
                    )}

                    <PlanSelector onGiftCardActivated={handleRefresh}>
                        <TopupPack onSuccess={handleRefresh} />
                    </PlanSelector>

                    <TransactionHistory records={records} onRefresh={handleRefresh} refreshing={refreshing} />
                </div>
            </div>
        </div>
    );
}