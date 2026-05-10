import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { SubscriptionRecordRouter } from "../../../api/instance";
import { SubscriptionTopupRequest } from "../../../../shared/modules/subscription_record/subscription_record.interface";
import PaymentModal from "./PaymentModal";

interface Plan {
    name: string;
    price: number;
    monthly_limit: number;
}

interface TopupPackProps {
    planName: string;
    planPrice: number;
    planMonthlyLimit: number;
    allPlans: Plan[];
    onSuccess: () => void;
}

const PRESET_AMOUNTS = [50_000_000, 100_000_000, 200_000_000, 500_000_000, 1_000_000_000];

export default function TopupPack({ planName, planPrice, planMonthlyLimit, allPlans, onSuccess }: TopupPackProps) {
    const locale = Locale("SubscriptionPage");
    const getToken = () => localStorage.getItem("access_token") || "";

    const [selectedAmount, setSelectedAmount] = useState<number>(PRESET_AMOUNTS[0]);
    const [customAmount, setCustomAmount] = useState("");
    const [paying, setPaying] = useState(false);
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);

    // 付费套餐按自己的单价算；免费用户按最贵的（base）单价 * 1.05
    let unitPrice = planPrice > 0 && planMonthlyLimit > 0 ? planPrice / planMonthlyLimit : 0;
    if (unitPrice <= 0) {
        const basePlan = allPlans.find(p => p.name === "base");
        if (basePlan && basePlan.price > 0 && basePlan.monthly_limit > 0) {
            unitPrice = (basePlan.price / basePlan.monthly_limit) * 1.05;
        }
    }

    const effectiveAmount = customAmount ? Math.max(Number(customAmount) * 1_000_000, 20_000_000) : selectedAmount;
    const finalPrice = unitPrice > 0 && effectiveAmount > 0 ? Math.floor(effectiveAmount * unitPrice) : 0;

    const isCustomValid = !customAmount || Number(customAmount) >= 20;
    const canBuy = finalPrice > 0 && isCustomValid;

    const handleBuy = async (payCurrency: string) => {
        const amount = customAmount ? Math.max(Number(customAmount) * 1_000_000, 20_000_000) : selectedAmount;
        if (amount <= 0) return;
        if (finalPrice <= 0) return;
        setPaying(true);
        try {
            const res = await SubscriptionRecordRouter.createtopup(new SubscriptionTopupRequest({
                auth: getToken(),
                token_amount: amount,
                pay_currency: payCurrency,
            }));
            if (res.success && res.data) {
                window.open(res.data.invoice_url, "_blank");
                onSuccess();
            }
        } catch (err) {
            console.error("Failed to create topup:", err);
        } finally {
            setPaying(false);
        }
    };

    const formatPrice = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);
    const toM = (val: number) => (val / 1_000_000).toFixed(0) + "M";

    const unitPriceExists = unitPrice > 0;
    if (!unitPriceExists) return null;

    return (
        <>
            <div className="flex flex-col gap-3">
                <div className="flex items-start gap-4">
                    {/* Left: preset buttons + custom input */}
                    <div className="flex-1 space-y-2">
                        <div className="flex flex-wrap gap-2">
                            {PRESET_AMOUNTS.map((amount) => (
                                <Button
                                    key={amount}
                                    size="sm"
                                    variant="flat"
                                    color={!customAmount && selectedAmount === amount ? "primary" : "default"}
                                    onPress={() => {
                                        setSelectedAmount(amount);
                                        setCustomAmount("");
                                    }}
                                >
                                    {toM(amount)}
                                </Button>
                            ))}
                        </div>
                        <Input
                            type="number"
                            size="sm"
                            placeholder={locale.TopupPlaceholder + " (M)"}
                            value={customAmount}
                            onValueChange={(val) => {
                                setCustomAmount(val);
                                if (val) setSelectedAmount(0);
                            }}
                            min={20}
                            errorMessage={!isCustomValid ? "最小 20M" : undefined}
                            isInvalid={!isCustomValid}
                            className="max-w-xs"
                        />
                    </div>

                    {/* Right: unit price + estimated price + buy button */}
                    <div className="flex flex-col items-end gap-1 min-w-[180px]">
                        <span className="text-xs text-gray-500">
                            {locale.TopupUnitPrice}: ${(unitPrice / 100 * 1000000).toFixed(6)}/M credits
                        </span>
                        <span className="text-lg font-bold text-primary">
                            {finalPrice > 0 ? formatPrice(finalPrice) : "—"}
                        </span>
                        {/* <span className="text-xs text-gray-400">{locale.TopupPriceHint}</span> */}
                        <Button
                            color="primary"
                            size="sm"
                            isDisabled={!canBuy}
                            isLoading={paying}
                            onPress={() => {
                                setPaymentModalOpen(true);
                            }}
                            className="mt-1"
                        >
                            {locale.TopupBuy}
                        </Button>
                    </div>
                </div>
            </div>

            <PaymentModal
                isOpen={paymentModalOpen}
                onOpenChange={() => setPaymentModalOpen(false)}
                planName="topup"
                planPrice={finalPrice}
                onProceedToPay={handleBuy}
                paying={paying}
            />
        </>
    );
}