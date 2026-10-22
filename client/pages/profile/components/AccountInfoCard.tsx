import { Card, CardBody, CardHeader, Divider, Chip, Progress } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { money } from "../../../methods/money";

export default function AccountInfoCard({
    account,
    weeklyUsage,
    balance,
    weeklyLimit,
}: {
    account: { name: string; email: string; is_admin: number };
    weeklyUsage?: number;
    balance?: number;
    weeklyLimit?: number;
}) {
    const locale = Locale("ProfilePage");
    const usage = weeklyUsage ?? 0;
    const limit = weeklyLimit || 0;
    const progressPercent = limit > 0 ? Math.min((usage / limit) * 100, 100) : 0;

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
                    <div className="w-full md:w-48 flex flex-col items-center justify-center md:pl-6">
                        <span className="text-sm text-gray-500 mb-1 ml-2">{locale.Balance}</span>
                        <span className="text-2xl font-bold text-primary">{money(balance || 0)}</span>
                        <div className="mt-3 w-full">
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>{locale.WeeklyUsage}</span>
                                <span>{money(usage, 3)} / {money(limit)}</span>
                            </div>
                            <Progress
                                aria-label="Weekly usage"
                                size="sm"
                                value={progressPercent}
                                color={progressPercent >= 100 ? "danger" : progressPercent >= 80 ? "warning" : "primary"}
                            />
                        </div>
                    </div>
                </div>
            </CardBody>
        </Card>
    );
}