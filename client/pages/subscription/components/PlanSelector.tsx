import { Card, CardBody, CardHeader, Divider, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

interface Plan {
    id: string;
    name: string;
    monthly_limit: number;
    price: number;
    duration_days: number;
}

export default function PlanSelector({
    plans,
    currentPlan,
    onSelect,
}: {
    plans: Plan[];
    currentPlan: string;
    onSelect: (plan: Plan) => void;
}) {
    const locale = Locale("SubscriptionPage");

    const toM = (val: number) => (val / 1_000_000).toFixed(0) + "M";
    const formatPrice = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.AvailablePlans}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {plans.sort((a, b) => a.price - b.price).map(plan => {
                        const isCurrent = plan.name === currentPlan;
                        const currentPrice = plans.find(p => p.name === currentPlan)?.price ?? 0;
                        return (!!plan?.price && (<Card
                            key={plan.id}
                            className={`border-2 ${isCurrent ? "border-primary" : "border-transparent"}`}
                        >
                            <CardBody className="p-4 space-y-3">
                                <p className="text-lg font-bold">{plan.name.toUpperCase()}</p>
                                <p className="text-2xl font-bold text-primary">
                                    {formatPrice(plan.price)}
                                </p>
                                <p className="text-sm text-gray-500">
                                    {toM(plan.monthly_limit)} {locale.TokensPerMonth}
                                </p>

                                <Button
                                    color={isCurrent ? "default" : "primary"}
                                    variant={isCurrent ? "flat" : "solid"}
                                    isDisabled={plan.price <= currentPrice}
                                    onPress={() => onSelect(plan)}
                                    className="w-full"
                                >
                                    {isCurrent ? locale.Current : plan.name === "free" ? locale.Free : locale.Upgrade}
                                </Button>
                            </CardBody>
                        </Card>)
                        );
                    })}
                </div>
            </CardBody>
        </Card>
    );
}
