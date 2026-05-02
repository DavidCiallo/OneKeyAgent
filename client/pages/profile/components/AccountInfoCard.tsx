import { Card, CardBody, CardHeader, Divider, Chip } from "@heroui/react";
import { Locale } from "../../../methods/locale";

interface UsageData {
    today: number;
    thisWeek: number;
    total: number;
}

export default function AccountInfoCard({
    account,
    usage,
}: {
    account: { name: string; email: string; is_admin: number; monthly_limit: number };
    usage: UsageData | null;
}) {
    const locale = Locale("ProfilePage");

    const toM = (val: number) => (val / 1_000_000).toFixed(1);
    const monthLimit = account.monthly_limit || 100_000_000;

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
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">{locale.Today}</span>
                                    <span className="font-semibold text-primary">{toM(usage.today)}M</span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min((usage.today / (monthLimit / 8)) * 100, 100)}%` }} />
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">{locale.ThisWeek}</span>
                                    <span className="font-semibold text-success">{toM(usage.thisWeek)}M</span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-success rounded-full transition-all" style={{ width: `${Math.min((usage.thisWeek / (monthLimit / 4)) * 100, 100)}%` }} />
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-gray-500">{locale.Total}</span>
                                    <span className="font-semibold text-warning">{toM(usage.total)}M</span>
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-warning rounded-full transition-all" style={{ width: `${Math.min((usage.total / Math.max(usage.total, 1)) * 100, 100)}%` }} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </CardBody>
        </Card>
    );
}
