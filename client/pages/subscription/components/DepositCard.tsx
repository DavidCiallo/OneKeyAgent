import { Card, CardBody, CardHeader, Divider, Button, Input } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { useState } from "react";

interface DepositInfo {
    address: string;
    chain: string;
}

export default function DepositCard({
    deposit,
    selectedPlan,
    planPrice,
    onCheck,
    checking,
}: {
    deposit: DepositInfo | null;
    selectedPlan: string | null;
    planPrice: number;
    onCheck: () => void;
    checking: boolean;
}) {
    const locale = Locale("SubscriptionPage");
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (!deposit) return;
        try {
            await navigator.clipboard.writeText(deposit.address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* ignore */ }
    };

    if (!selectedPlan || selectedPlan === "free") return null;

    const formatPrice = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.Payment}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4 space-y-4">
                <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    <p className="text-sm text-gray-600">
                        {locale.DepositAmount}: <span className="font-bold text-primary">{formatPrice(planPrice)} USDT</span>
                    </p>
                    <p className="text-sm text-gray-600">{locale.DepositHint}</p>
                </div>

                {deposit && (
                    <div className="space-y-2">
                        <p className="text-sm text-gray-500">{locale.DepositAddress} ({deposit.chain.toUpperCase()}):</p>
                        <div className="flex gap-2">
                            <Input
                                value={deposit.address}
                                isReadOnly
                                className="flex-1"
                                size="sm"
                            />
                            <Button size="sm" variant="flat" onPress={handleCopy}>
                                {copied ? locale.Copied : locale.Copy}
                            </Button>
                        </div>
                    </div>
                )}

                <Button
                    color="primary"
                    variant="flat"
                    onPress={onCheck}
                    isLoading={checking}
                    className="w-full"
                >
                    {locale.CheckPayment}
                </Button>
            </CardBody>
        </Card>
    );
}
