import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Button } from "@heroui/react";
import { ModelDTO } from "../../../../shared/modules/model/model.entity";
import { Locale } from "../../../methods/locale";

type Props = {
    list: ModelDTO[];
    onEdit: (item: ModelDTO) => void;
    onDelete: (id: string) => void;
    onUsageClick: (item: ModelDTO) => void;
};

export function ModelTable({ list, onEdit, onDelete, onUsageClick }: Props) {
    const locale = Locale("ModelPage");

    return (
        <Table aria-label="Model list" className="flex-1 overflow-auto">
            <TableHeader>
                <TableColumn align="center" className="min-w-20">{locale.Tier}</TableColumn>
                <TableColumn>{locale.BaseURL}</TableColumn>
                <TableColumn align="center">{locale.Model}</TableColumn>
                <TableColumn align="center">{locale.ApiKey}</TableColumn>
                <TableColumn align="center" className="min-w-40">{locale.ProxyURL}</TableColumn>
                <TableColumn>{locale.Actions}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={locale.NoData}>
                {list.map(item => (
                    <TableRow key={item.id}>
                        <TableCell>{item.tier}</TableCell>
                        <TableCell className="max-w-xs truncate">{item.baseURL}</TableCell>
                        <TableCell>{item.model}</TableCell>
                        <TableCell className="max-w-xs truncate">
                            {item.apiKey ? item.apiKey.slice(0, 12) + '...' + item.apiKey.slice(-8) : "—"}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{item.proxyURL || "—"}</TableCell>
                        <TableCell>
                            <div className="flex flex-row gap-2">
                                <Button size="sm" variant="flat" onPress={() => onUsageClick(item)}>
                                    {locale.Usage}
                                </Button>
                                <Button size="sm" variant="flat" onPress={() => onEdit(item)}>
                                    {locale.Edit}
                                </Button>
                                <Button size="sm" variant="flat" color="danger" onPress={() => onDelete(item.id)}>
                                    {locale.Delete}
                                </Button>
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}