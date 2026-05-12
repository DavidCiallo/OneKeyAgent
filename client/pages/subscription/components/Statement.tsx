import { Card, CardBody, CardHeader, Divider, Chip, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

// Statement.tsx
interface StatementRecord {
    id: string;
    type: "topup" | "bonus" | "gift_card" | "usage";
    amount: number;
    description: string;
    remark?: string;
    create_time: number;
}

function getAmountColor(type: string): string {
    if (type === "usage") return "text-danger";
    return "text-success";
}

function getAmountPrefix(type: string): string {
    if (type === "usage") return "-$";
    return "+$";
}

function getTypeChip(type: string, locale: any): { color: "success" | "primary" | "warning" | "danger"; label: string } {
    switch (type) {
        case "topup":
            return { color: "success", label: locale.TopupLabel || "Topup" };
        case "bonus":
            return { color: "primary", label: locale.BonusLabel || "Bonus" };
        case "gift_card":
            return { color: "warning", label: locale.GiftCardLabel || "Redeem" };
        case "usage":
            return { color: "danger", label: locale.UsageLabel || "Usage" };
        default:
            return { color: "default" as const, label: type };
    }
}

export default function Statement({ records, onRefresh, refreshing }: { records: StatementRecord[]; onRefresh?: () => void; refreshing?: boolean }) {
    const locale = Locale("SubscriptionPage");

    return (
        <Card>
            <CardHeader className="px-6 py-4 flex items-center justify-between">
                <span className="font-semibold text-lg">{locale.Statement || "Statement"}</span>
                {onRefresh && (
                    <Button size="sm" variant="flat" isIconOnly isLoading={refreshing} onPress={onRefresh}>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </Button>
                )}
            </CardHeader>
            <Divider />
            <CardBody className="px-6 py-4">
                {records.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">{locale.NoTransactions}</p>
                ) : (
                    <div className="space-y-3">
                        {records.map(record => {
                            const chip = getTypeChip(record.type, locale);
                            return (
                                <div key={record.id} className="flex items-center justify-between border-b border-gray-200/50 border-dashed pb-2 last:border-b-0">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{record.description}</span>
                                            <Chip size="sm" color={chip.color} variant="flat">
                                                {chip.label}
                                            </Chip>
                                        </div>
                                        {record.remark && (
                                            <p className="text-xs text-gray-400">{record.remark}</p>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <p className={`text-sm font-semibold ${getAmountColor(record.type)}`}>
                                            {getAmountPrefix(record.type)}{Math.abs(record.amount).toFixed(3)}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            {new Date(record.create_time).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardBody>
        </Card>
    );
}
