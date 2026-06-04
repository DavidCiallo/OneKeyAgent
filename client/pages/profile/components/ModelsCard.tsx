import { Card, CardBody, CardHeader, Divider, Chip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { Currency, formatPrice as formatCurrencyPrice } from "../../../methods/currency";

type ModelInfo = {
    id: string;
    input_price: number;
    output_price: number;
};

export default function ModelsCard({ models, currency, onToggleCurrency }: { models: ModelInfo[]; currency?: Currency; onToggleCurrency?: () => void }) {
    const locale = Locale("ProfilePage");

    const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id));

    const formatPrice = (dollarsPerMToken: number) => {
        return formatCurrencyPrice(dollarsPerMToken, currency || "USD");
    };

    return (
        <Card>
            <CardHeader className="px-6 py-4 justify-between">
                <span className="font-semibold text-lg">{locale.AvailableModels}</span>
                {onToggleCurrency && (
                    <button
                        className="flex items-center gap-1 text-xs text-default-500 bg-default-100 hover:bg-default-200 rounded-md px-2 py-1 transition-colors cursor-pointer"
                        onClick={onToggleCurrency}
                    >
                        <span>{currency === "CNY" ? "¥ CNY" : "$ USD"}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 16V4m0 0L3 8m4-4l4 4" />
                            <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
                        </svg>
                    </button>
                )}
            </CardHeader>
            <Divider />
            <CardBody className="px-6 py-4">
                <Table removeWrapper aria-label="Models table" className="min-w-full">
                    <TableHeader>
                        <TableColumn className="text-xs uppercase tracking-wider text-gray-500">{locale.ModelName}</TableColumn>
                        <TableColumn className="text-xs uppercase tracking-wider text-gray-500">{locale.InputPrice}</TableColumn>
                        <TableColumn className="text-xs uppercase tracking-wider text-gray-500">{locale.OutputPrice}</TableColumn>
                    </TableHeader>
                    <TableBody emptyContent="No models available">
                        {sorted.map(m => (
                            <TableRow key={m.id}>
                                <TableCell>
                                    <span className="font-mono text-sm">{m.id}</span>
                                </TableCell>
                                <TableCell>
                                    <Chip size="sm" variant="flat">
                                        {formatPrice(m.input_price)}
                                    </Chip>
                                </TableCell>
                                <TableCell>
                                    <Chip size="sm" variant="flat">
                                        {formatPrice(m.output_price)}
                                    </Chip>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardBody>
        </Card>
    );
}