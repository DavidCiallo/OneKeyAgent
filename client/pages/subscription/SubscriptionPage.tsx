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
    } | null>(null);

    const [plans, setPlans] = useState<Plan[]>([]);
    const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
    const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
    const [paymentId, setPaymentId] = useState<string | null>(null);
    const [records, setRecords] = useState<TxRecord[]>([]);
    const [checking, setChecking] = useState(false);
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
            setRecords(res.data.list);
        }
    }, []);

    useEffect(() => {
        fetchProfile();
        fetchPlans();
        fetchRecords();
    }, [fetchProfile, fetchPlans, fetchRecords]);

    const handleSelectPlan = async (plan: Plan) => {
        setSelectedPlan(plan.name);
        if (plan.name !== "free") {
            try {
                const res = await SubscriptionRecordRouter.createpayment(new SubscriptionCreatePaymentRequest({
                    auth: getToken(),
                    plan_name: plan.name,
                }));
                if (res.success && res.data) {
                    setInvoiceUrl(res.data.invoice_url);
                    setPaymentId(res.data.payment_id);
                    paymentModal.onOpen();
                }
            } catch (err) {
                console.error("Failed to create payment:", err);
            }
        }
    };

    const handleCheckPayment = async () => {
        setChecking(true);
        await fetchRecords();
        await fetchProfile();
        setChecking(false);
        paymentModal.onClose();
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchRecords();
        await fetchProfile();
        setRefreshing(false);
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
                            monthly_limit: plans.find(p => p.name === account.plan)?.monthly_limit ?? 90_000_000,
                            plan_expires_at: account.plan_expires_at,
                        }} />
                    )}

                    <PlanSelector
                        plans={plans}
                        currentPlan={account?.plan || "free"}
                        onSelect={handleSelectPlan}
                    />

                    {selectedPlanData && (
                        <PaymentModal
                            isOpen={paymentModal.isOpen}
                            onOpenChange={paymentModal.onOpenChange}
                            invoiceUrl={invoiceUrl}
                            planName={selectedPlanData.name}
                            planPrice={selectedPlanData.price}
                            onCheck={handleCheckPayment}
                            checking={checking}
                        />
                    )}

                    <TransactionHistory records={records} onRefresh={handleRefresh} refreshing={refreshing} />
                </div>
            </div>
        </div>
    );
}
