import { Card, CardBody, CardHeader, Divider, Chip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type ModelInfo = {
    id: string;
    input_price: number;
    output_price: number;
};

export default function ModelsCard({ models }: { models: ModelInfo[] }) {
    const locale = Locale("ProfilePage");

    const sorted = [...models].sort((a, b) => a.id.localeCompare(b.id));

    const formatPrice = (dollarsPerMToken: number) => {
        if (dollarsPerMToken <= 0) return "-";
        return `$${dollarsPerMToken.toFixed(2)}/M`;
    };

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.AvailableModels}</CardHeader>
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