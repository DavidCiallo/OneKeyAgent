import { Card, CardBody, CardHeader, Divider, Chip, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

interface TxRecord {
    id: string;
    txid: string;
    amount: number;
    status: string;
    type: string;
    create_time: number;
}

const STATUS_MAP: Record<string, { color: "warning" | "success" | "danger" | "default"; label: string }> = {
    pending: { color: "warning", label: "Pending" },
    confirmed: { color: "success", label: "Confirmed" },
    expired: { color: "danger", label: "Expired" },
};

function getTypeLabel(type: string, locale: any): string {
    if (type === "bonus") return locale.BonusLabel || "Bonus";
    return locale.TopupLabel || "Topup";
}

export default function TransactionHistory({ records, onRefresh, refreshing }: { records: TxRecord[]; onRefresh?: () => void; refreshing?: boolean }) {
    const locale = Locale("SubscriptionPage");

    return (
        <Card>
            <CardHeader className="px-6 py-4 flex items-center justify-between">
                <span className="font-semibold text-lg">{locale.TransactionHistory}</span>
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
                            const status = STATUS_MAP[record.status] || STATUS_MAP.default;
                            return (
                                <div key={record.id} className="flex items-center justify-between border-b border-gray-200/50 border-dashed pb-2 last:border-b-0">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{getTypeLabel(record.type, locale)}</span>
                                            <Chip size="sm" color={status.color} variant="flat">
                                                {status.label}
                                            </Chip>
                                        </div>
                                        {record.type !== "bonus" && (
                                            <p className="text-xs text-gray-400 font-mono truncate max-w-48">
                                                {record.txid}
                                            </p>
                                        )}
                                        {record.type === "bonus" && (
                                            <p className="text-xs text-gray-400 font-mono">
                                                #{String(record.create_time).slice(-6)}
                                            </p>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-semibold">
                                            ${record.amount.toFixed(2)}
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            {new Date(record.create_time).toLocaleDateString()}
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
