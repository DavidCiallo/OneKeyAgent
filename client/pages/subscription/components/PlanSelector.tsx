import { Card, CardBody, CardHeader, Divider, Button, useDisclosure } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import GiftCardModal from "./GiftCardModal";

interface Plan {
    id: string;
    name: string;
    monthly_limit: number;
    price: number;
    duration_days: number;
}

interface PlanSelectorProps {
    plans: Plan[];
    currentPlan: string;
    onSelect: (plan: Plan) => void;
    onGiftCardActivated?: () => void;
    children?: React.ReactNode;
}

export default function PlanSelector({ plans, currentPlan, onSelect, onGiftCardActivated, children }: PlanSelectorProps) {
    const t = Locale("SubscriptionPage");
    const giftCardModal = useDisclosure();

    const toM = (val: number) => (val / 1_000_000).toFixed(0) + "M";
    const formatPrice = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);

    const currentPrice = plans.find((p) => p.name === currentPlan)?.price ?? 0;

    const handleContactService = () => {
        window.open(`https://t.me/${process.env.TG_USER_ID}`, "_blank");
    };

    const handleGiftCardActivated = () => {
        onGiftCardActivated?.();
    };

    return (
        <>
            <Card>
                <CardHeader className="px-6 py-4 font-semibold text-lg">{t.AvailablePlans}</CardHeader>
                <Divider />
                <CardBody className="px-6 py-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {plans
                            .sort((a, b) => a.price - b.price)
                            .map((plan) => {
                                const isCurrent = plan.name === currentPlan;
                                const isDisabled = plan.price <= currentPrice;
                                return plan.price ? (
                                    <Card
                                        key={plan.id}
                                        className={`border-2 ${isCurrent ? "border-primary" : "border-transparent"}`}
                                    >
                                        <CardBody className="p-4 space-y-3">
                                            <p className="text-lg">{plan.name.toUpperCase()}</p>
                                            <p className="text-2xl font-bold text-primary">
                                                {formatPrice(plan.price)}
                                                <span className="text-sm font-normal text-gray-500">
                                                    /{plan.duration_days}d
                                                </span>
                                            </p>
                                            <p className="text-sm text-gray-500">
                                                {toM(plan.monthly_limit)} {t.TokensPerMonth}
                                            </p>
                                            <Button
                                                color={isCurrent ? "default" : "primary"}
                                                variant={isCurrent ? "flat" : "solid"}
                                                isDisabled={isDisabled}
                                                onPress={() => onSelect(plan)}
                                                className="w-full"
                                            >
                                                {isCurrent
                                                    ? t.Current
                                                    : plan.name === "free"
                                                        ? t.Free
                                                        : t.Upgrade}
                                            </Button>
                                        </CardBody>
                                    </Card>
                                ) : null;
                            })}

                        {/* Ultra */}
                        <div className="rounded-xl bg-gradient-to-b from-purple-100 to-transparent dark:from-purple-900/20 px-4 py-6 space-y-4 flex flex-col shadow-lg shadow-purple-500/10">
                            <p className="text-lg">{t.Ultra}</p>
                            <p className="text-sm text-gray-500">{t.UltraDesc}</p>
                            <div className="flex-1" />
                            <Button
                                color="secondary"
                                variant="solid"
                                onPress={handleContactService}
                                className="w-full text-white"
                            >
                                {t.ContactService}
                            </Button>
                        </div>

                        {/* 礼品卡 */}
                        <div className="rounded-xl bg-gradient-to-b from-amber-100 to-transparent dark:from-amber-900/20 px-4 py-6 space-y-4 flex flex-col shadow-lg shadow-amber-500/10">
                            <p className="text-lg">{t.GiftCard}</p>
                            <p className="text-sm text-gray-500">{t.GiftCardDesc}</p>
                            <div className="flex-1" />
                            <Button
                                color="warning"
                                variant="solid"
                                onPress={giftCardModal.onOpen}
                                className="w-full text-white"
                            >
                                {t.Activate}
                            </Button>
                        </div>
                    </div>
                {children && (
                        <div className="border-t border-gray-100 pt-3 mt-3">
                            {children}
                        </div>
                    )}
                </CardBody>
            </Card>

            <GiftCardModal
                isOpen={giftCardModal.isOpen}
                onOpenChange={giftCardModal.onOpenChange}
                onSuccess={handleGiftCardActivated}
            />
        </>
    );
}