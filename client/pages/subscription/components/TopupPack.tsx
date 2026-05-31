import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { subscriptionApi } from "../../../api/instance";
import PaymentModal from "./PaymentModal";

interface TopupPackProps {
    onSuccess: () => void;
}

const PRESET_AMOUNTS = [50, 100, 500, 1000]; // USD

export default function TopupPack({ onSuccess }: TopupPackProps) {
    const locale = Locale("SubscriptionPage");

    const [selectedAmount, setSelectedAmount] = useState<number>(PRESET_AMOUNTS[0]);
    const [customAmount, setCustomAmount] = useState("");
    const [paying, setPaying] = useState(false);
    const [paymentModalOpen, setPaymentModalOpen] = useState(false);

    // 1 token = 1 USD, input is in USD
    const effectiveAmount = customAmount ? Math.max(Number(customAmount), 3) : selectedAmount;
    const finalPrice = effectiveAmount; // dollars

    const isCustomValid = !customAmount || Number(customAmount) >= 3;
    const canBuy = finalPrice > 0 && isCustomValid;

    const handleBuy = async (payCurrency: string) => {
        const amount = customAmount ? Math.max(Number(customAmount), 3) : selectedAmount;
        if (amount <= 0) return;
        setPaying(true);
        try {
            const res = await subscriptionApi.createtopup({
                token_amount: amount,
                pay_currency: payCurrency,
            });
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

    const formatPrice = (dollars: number) => "$" + dollars.toFixed(2);

    return (
        <>
            <div className="flex flex-col gap-2">
                <p className="text-sm font-medium">{locale.Recharge}</p>
                <div className="w-full flex justify-between items-start gap-2">
                    <div className="space-y-2 w-1/2">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
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
                                    ${amount}
                                </Button>
                            ))}
                        </div>
                        <Input
                            size="sm"
                            placeholder={locale.RechargePlaceholder}
                            value={customAmount}
                            onValueChange={(val) => {
                                setCustomAmount(val);
                                if (val) setSelectedAmount(0);
                            }}
                            className="w-full text-xs"
                            errorMessage={!isCustomValid ? "最低 $3" : undefined}
                            isInvalid={!isCustomValid}
                        />
                    </div>
                    <div className="flex flex-col items-end gap-1 min-w-1/2 md:min-w-[180px]">
                        <span className="text-lg font-bold text-primary mx-1">
                            {finalPrice > 0 ? formatPrice(finalPrice) : "—"}
                        </span>
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
                            {locale.RechargeBuy}
                        </Button>
                    </div>
                </div>
            </div>

            <PaymentModal
                isOpen={paymentModalOpen}
                onOpenChange={() => setPaymentModalOpen(false)}
                planPrice={finalPrice}
                onProceedToPay={handleBuy}
                paying={paying}
            />
        </>
    );
}