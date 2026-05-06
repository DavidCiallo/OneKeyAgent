import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { AccountRouter, SubscriptionPlanRouter, SubscriptionRecordRouter } from "../../api/instance";
import { AccountProfileRequest } from "../../../shared/modules/account/account.interface";
import { SubscriptionPlanListRequest } from "../../../shared/modules/subscription_plan/subscription_plan.interface";
import { SubscriptionRecordListRequest, SubscriptionAddressRequest } from "../../../shared/modules/subscription_record/subscription_record.interface";
import { Locale } from "../../methods/locale";
import CurrentPlanCard from "./components/CurrentPlanCard";
import PlanSelector from "./components/PlanSelector";
import DepositCard from "./components/DepositCard";
import TransactionHistory from "./components/TransactionHistory";

interface Plan {
    id: string;
    name: string;
    monthly_limit: number;
    price: number;
    duration_days: number;
}

interface TxRecord {
    id: string;
    plan_name: string;
    txid: string;
    from_address: string;
    amount: number;
    status: string;
    create_time: number;
}

export default function SubscriptionPage() {
    const menuLocale = Locale("Menu");
    const getToken = () => localStorage.getItem("access_token") || "";

    const [account, setAccount] = useState<{
        name: string;
        plan: string;
        monthly_limit: number;
        plan_expires_at: number | null;
    } | null>(null);

    const [plans, setPlans] = useState<Plan[]>([]);
    const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
    const [deposit, setDeposit] = useState<{ address: string; chain: string } | null>(null);
    const [records, setRecords] = useState<TxRecord[]>([]);
    const [checking, setChecking] = useState(false);

    const fetchProfile = useCallback(async () => {
        const res = await AccountRouter.profile(new AccountProfileRequest({ auth: getToken() }));
        if (res.success && res.data?.account) {
            setAccount(res.data.account);
        }
    }, []);

    const fetchPlans = useCallback(async () => {
        const res = await SubscriptionPlanRouter.list(new SubscriptionPlanListRequest({ auth: getToken() }));
        if (res.success && res.data) {
            setPlans(res.data.list);
        }
    }, []);

    const fetchRecords = useCallback(async () => {
        const res = await SubscriptionRecordRouter.records(new SubscriptionRecordListRequest({ auth: getToken() }));
        if (res.success && res.data) {
            setRecords(res.data.list);
        }
    }, []);

    const fetchAddress = useCallback(async () => {
        try {
            const res = await SubscriptionRecordRouter.address(new SubscriptionAddressRequest({ auth: getToken() }));
            if (res.success && res.data) {
                setDeposit(res.data);
            }
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        fetchProfile();
        fetchPlans();
        fetchRecords();
        fetchAddress();
    }, [fetchProfile, fetchPlans, fetchRecords, fetchAddress]);

    const handleSelectPlan = async (plan: Plan) => {
        setSelectedPlan(plan.name);
        // Fetch deposit address when a paid plan is selected
        if (plan.name !== "free" && !deposit) {
            try {
                const res = await SubscriptionRecordRouter.address(new SubscriptionAddressRequest({ auth: getToken() }));
                if (res.success && res.data) {
                    setDeposit(res.data);
                }
            } catch { /* ignore */ }
        }
    };

    const handleCheckPayment = async () => {
        setChecking(true);
        await fetchRecords();
        await fetchProfile();
        setChecking(false);
    };

    const selectedPlanData = plans.find(p => p.name === selectedPlan);

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={menuLocale.Subscription || "Subscription"} />
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto space-y-6">
                    {account && (
                        <CurrentPlanCard plan={{
                            name: account.plan,
                            monthly_limit: account.monthly_limit,
                            plan_expires_at: account.plan_expires_at,
                        }} />
                    )}

                    <PlanSelector
                        plans={plans}
                        currentPlan={account?.plan || "free"}
                        onSelect={handleSelectPlan}
                    />

                    {selectedPlanData && (
                        <DepositCard
                            deposit={deposit}
                            selectedPlan={selectedPlan}
                            planPrice={selectedPlanData.price}
                            onCheck={handleCheckPayment}
                            checking={checking}
                        />
                    )}

                    <TransactionHistory records={records} />
                </div>
            </div>
        </div>
    );
}
