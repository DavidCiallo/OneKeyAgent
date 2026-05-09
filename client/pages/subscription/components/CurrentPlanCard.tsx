import { Card, CardBody, CardHeader, Divider, Chip, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

interface PlanInfo {
    name: string;
    monthly_limit: number;
    plan_expires_at: number | null;
}

export default function CurrentPlanCard({ plan }: { plan: PlanInfo }) {
    const locale = Locale("SubscriptionPage");

    const toM = (val: number) => (val / 1_000_000).toFixed(0) + "M";

    const planColor = plan.name === "free" ? "default" : plan.name === "pro" ? "primary" : "warning";
    const isExpired = plan.plan_expires_at && plan.plan_expires_at < Date.now();

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.CurrentPlan}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4 space-y-3">
                <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500 w-24">{locale.PlanName}</span>
                    <Chip size="sm" color={planColor} variant="flat" className="mx-1">
                        {plan.name.toUpperCase()}
                    </Chip>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500 w-24">{locale.MonthlyLimit}</span>
                    <span className="text-sm font-medium pl-2">{toM(plan.monthly_limit)}</span>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500 w-24">{locale.Expires}</span>
                    <span className="text-sm font-medium pl-2">
                        {plan.plan_expires_at ?
                            isExpired ? locale.Expired : new Date(plan.plan_expires_at).toLocaleString()
                            : "N/A"}
                    </span>
                </div>
            </CardBody>
        </Card>
    );
}
