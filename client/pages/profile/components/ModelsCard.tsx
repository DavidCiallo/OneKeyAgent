import { Card, CardBody, CardHeader, Divider, Chip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type ModelInfo = {
    id: string;
    tier: number;
};

export default function ModelsCard({ models }: { models: ModelInfo[] }) {
    const locale = Locale("ProfilePage");

    const sorted = [...models].sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.AvailableModels}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4">
                <Table removeWrapper aria-label="Models table" className="min-w-full">
                    <TableHeader>
                        <TableColumn className="text-xs uppercase tracking-wider text-gray-500">{locale.ModelName}</TableColumn>
                        <TableColumn className="text-xs uppercase tracking-wider text-gray-500">{locale.Tier}</TableColumn>
                    </TableHeader>
                    <TableBody emptyContent="No models available">
                        {sorted.map(m => (
                            <TableRow key={m.id}>
                                <TableCell>
                                    <span className="font-mono text-sm">{m.id}</span>
                                </TableCell>
                                <TableCell>
                                    <Chip size="sm" color={m.tier > 1 ? "warning" : "default"} variant="flat">
                                        {m.tier}x
                                    </Chip>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <div className="mt-4 pt-3 border-t border-default-100">
                    <p className="text-xs text-gray-400">{locale.BillingHint}</p>
                </div>
            </CardBody>
        </Card>
    );
}