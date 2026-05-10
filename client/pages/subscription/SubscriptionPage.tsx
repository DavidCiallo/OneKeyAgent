import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { useDisclosure } from "@heroui/react";
import { AccountRouter, SubscriptionPlanRouter, SubscriptionRecordRouter } from "../../api/instance";
import { AccountProfileRequest } from "../../../shared/modules/account/account.interface";
import { SubscriptionPlanListRequest } from "../../../shared/modules/subscription_plan/subscription_plan.interface";
import { SubscriptionRecordListRequest, SubscriptionCreatePaymentRequest } from "../../../shared/modules/subscription_record/subscription_record.interface";
import { Locale } from "../../methods/locale";
import CurrentPlanCard from "./components/CurrentPlanCard";
import PlanSelector from "./components/PlanSelector";
import PaymentModal from "./components/PaymentModal";
import TransactionHistory from "./components/TransactionHistory";
import TopupPack from "./components/TopupPack";

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
        plan_expires_at: number | null;
        topup_tokens?: number;
    } | null>(null);

    const [plans, setPlans] = useState<Plan[]>([]);
    const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
    const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
    const [paymentId, setPaymentId] = useState<string | null>(null);
    const [records, setRecords] = useState<TxRecord[]>([]);
    const [paying, setPaying] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const paymentModal = useDisclosure();

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
            setRecords(res.data.list?.filter(r => r.status !== "expired" || Date.now() - r.create_time < 6 * 60 * 60 * 1000));
        }
    }, []);

    useEffect(() => {
        fetchProfile();
        fetchPlans();
        fetchRecords();
    }, [fetchProfile, fetchPlans, fetchRecords]);

    const handleSelectPlan = (plan: Plan) => {
        setSelectedPlan(plan);
        if (plan.name !== "free") {
            setInvoiceUrl(null);
            setPaymentId(null);
            paymentModal.onOpen();
        }
    };

    const handleProceedToPay = async (payCurrency: string) => {
        if (!selectedPlan) return;
        setPaying(true);
        try {
            const res = await SubscriptionRecordRouter.createpayment(new SubscriptionCreatePaymentRequest({
                auth: getToken(),
                plan_name: selectedPlan.name,
                pay_currency: payCurrency,
            }));
            if (res.success && res.data) {
                setInvoiceUrl(res.data.invoice_url);
                setPaymentId(res.data.payment_id);
                window.open(res.data.invoice_url, "_blank");
            }
        } catch (err) {
            console.error("Failed to create payment:", err);
        } finally {
            setPaying(false);
        }
    };

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
                        <CurrentPlanCard plan={{
                            name: account.plan,
                            monthly_limit: plans.find(p => p.name === account.plan)?.monthly_limit ?? 90_000_000,
                            plan_expires_at: account.plan_expires_at,
                            topup_tokens: account.topup_tokens || 0,
                        }} />
                    )}

                    <PlanSelector
                        plans={plans}
                        currentPlan={account?.plan || "free"}
                        onSelect={handleSelectPlan}
                        onGiftCardActivated={handleRefresh}
                    >
                        {account && (() => {
                            const currentPlan = plans.find(p => p.name === account.plan);
                            return currentPlan && currentPlan.price > 0 ? (
                                <TopupPack
                                    planName={currentPlan.name}
                                    planPrice={currentPlan.price}
                                    planMonthlyLimit={currentPlan.monthly_limit}
                                    allPlans={plans}
                                    onSuccess={handleRefresh}
                                />
                            ) : plans.length > 0 ? (
                                <TopupPack
                                    planName="free"
                                    planPrice={0}
                                    planMonthlyLimit={0}
                                    allPlans={plans}
                                    onSuccess={handleRefresh}
                                />
                            ) : null;
                        })()}
                    </PlanSelector>

                    {selectedPlan && (
                        <PaymentModal
                            isOpen={paymentModal.isOpen}
                            onOpenChange={paymentModal.onOpenChange}
                            planName={selectedPlan.name}
                            planPrice={selectedPlan.price}
                            onProceedToPay={handleProceedToPay}
                            paying={paying}
                        />
                    )}

                    <TransactionHistory records={records} onRefresh={handleRefresh} refreshing={refreshing} />
                </div>
            </div>
        </div>
    );
}
