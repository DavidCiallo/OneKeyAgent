import { Card, CardBody, CardHeader, Divider, Chip } from "@heroui/react";
import { Locale } from "../../../methods/locale";

interface TxRecord {
    id: string;
    plan_name: string;
    txid: string;
    from_address: string;
    amount: number;
    status: string;
    create_time: number;
}

const STATUS_MAP: Record<string, { color: "warning" | "success" | "danger" | "default"; label: string }> = {
    pending: { color: "warning", label: "Pending" },
    confirmed: { color: "success", label: "Confirmed" },
    failed: { color: "danger", label: "Failed" },
};

export default function TransactionHistory({ records }: { records: TxRecord[] }) {
    const locale = Locale("SubscriptionPage");

    const toM = (val: number) => (val / 1_000_000).toFixed(0);

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.TransactionHistory}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4">
                {records.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">{locale.NoTransactions}</p>
                ) : (
                    <div className="space-y-3">
                        {records.map(record => {
                            const status = STATUS_MAP[record.status] || STATUS_MAP.default;
                            return (
                                <div key={record.id} className="flex items-center justify-between border-b pb-2 last:border-b-0">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium">{record.plan_name.toUpperCase()}</span>
                                            <Chip size="sm" color={status.color} variant="flat">
                                                {status.label}
                                            </Chip>
                                        </div>
                                        <p className="text-xs text-gray-400 font-mono truncate max-w-48">
                                            {record.txid}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm font-semibold">
                                            ${(record.amount / 1_000_000).toFixed(2)}
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
