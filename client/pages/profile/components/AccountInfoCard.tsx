import { Card, CardBody, CardHeader, Divider, Chip } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { useEffect, useState } from "react";

interface UsageData {
    today: number;
    thisWeek: number;
    total: number;
}

const DEFAULT_MONTHLY_LIMIT = 90_000_000;
const fmt = (val: number) => {
    if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + "M";
    if (val >= 1000) return (val / 1000).toFixed(1) + "K";
    return val.toString();
};

export default function AccountInfoCard({
    account,
    usage,
}: {
    account: { name: string; email: string; is_admin: number; plan?: string; plan_expires_at?: number | null };
    usage: UsageData | null;
}) {
    const locale = Locale("ProfilePage");
    const [monthLimit, setMonthLimit] = useState(DEFAULT_MONTHLY_LIMIT);

    useEffect(() => {
        (async () => {
            try {
                const { SubscriptionPlanRouter } = await import("../../../api/instance");
                const { SubscriptionPlanListRequest } = await import("../../../../shared/modules/subscription_plan/subscription_plan.interface");
                const res = await SubscriptionPlanRouter.list(new SubscriptionPlanListRequest({}));
                if (res.success && res.data) {
                    const plan = res.data.list.find((p: any) => p.name === (account.plan || "free"));
                    if (plan) setMonthLimit(plan.monthly_limit);
                }
            } catch { /* ignore */ }
        })();
    }, [account.plan]);

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.AccountInfo}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4">
                <div className="flex flex-col md:flex-row gap-6">
                    <div className="space-y-4 flex-1">
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-500 w-20">{locale.Name}</span>
                            <span className="text-sm font-medium">{account.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-500 w-20">{locale.Email}</span>
                            <span className="text-sm font-medium">{account.email}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className="text-sm text-gray-500 w-20">{locale.Role}</span>
                            <Chip size="sm" color={account.is_admin ? "warning" : "default"} variant="flat">
                                {account.is_admin ? locale.Admin : locale.User}
                            </Chip>
                        </div>
                    </div>
                    {usage && (
                        <div className="w-full md:w-56 space-y-3 md:pl-6">
                            <div className="flex justify-between items-center mx-[-5px]">
                                <Chip size="sm" color={account.plan === "free" ? "default" : account.plan === "pro" ? "primary" : "warning"} variant="flat">
                                    {account.plan?.toUpperCase() || "FREE"}
                                </Chip>
                                {account.plan !== "free" && account.plan_expires_at && account.plan_expires_at > Date.now() && (
                                    <span className="text-xs text-gray-400">
                                        Expires: {new Date(account.plan_expires_at).toLocaleDateString()}
                                    </span>
                                )}
                                {account.plan == "free" && (
                                    <span className="text-xs text-gray-400">
                                        Expires: N/A
                                    </span>
                                )}
                            </div>
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">{locale.Today}</span>
                                    <span className="font-semibold text-primary">
                                        {fmt(usage.today)}/{fmt(monthLimit / 12)}
                                    </span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary rounded-full transition-all"
                                        style={{ width: `${Math.min((usage.today / (monthLimit / 12)) * 100, 100)}%` }}
                                    />
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">{locale.ThisWeek}</span>
                                    <span className="font-semibold text-danger">
                                        {fmt(usage.thisWeek)}/{fmt(monthLimit / 4)}
                                    </span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-success rounded-full transition-all" style={{ width: `${Math.min((usage.thisWeek / (monthLimit / 4)) * 100, 100)}%` }} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </CardBody>
        </Card>
    );
}
