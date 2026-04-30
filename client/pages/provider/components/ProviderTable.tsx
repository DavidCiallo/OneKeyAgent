import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Button, Chip } from "@heroui/react";
import { ProviderDTO } from "../../../../shared/modules/provider/provider.interface";
import { Locale } from "../../../methods/locale";

type Props = {
    list: ProviderDTO[];
    onEdit: (item: ProviderDTO) => void;
    onDelete: (id: string) => void;
};

export function ProviderTable({ list, onEdit, onDelete }: Props) {
    const locale = Locale("ProviderPage");

    return (
        <Table aria-label="Provider list" className="flex-1 overflow-auto">
            <TableHeader>
                <TableColumn align="center">{locale.ModelAlias}</TableColumn>
                <TableColumn align="center">{locale.Priority}</TableColumn>
                <TableColumn>{locale.Name}</TableColumn>
                <TableColumn className="min-w-40">{locale.BaseURL}</TableColumn>
                <TableColumn align="center">{locale.Model}</TableColumn>
                <TableColumn align="center">{locale.ApiKey}</TableColumn>
                <TableColumn align="center">{locale.ProxyURL}</TableColumn>
                <TableColumn align="center">{locale.Enabled}</TableColumn>
                <TableColumn>{locale.Actions}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={locale.NoData}>
                {list.map(item => (
                    <TableRow key={item.id}>
                        <TableCell>{item.modelAlias}</TableCell>
                        <TableCell>{item.priority}</TableCell>
                        <TableCell className="max-w-xs truncate">{item.name}</TableCell>
                        <TableCell className="max-w-xs truncate">{item.baseURL}</TableCell>
                        <TableCell>{item.model}</TableCell>
                        <TableCell className="max-w-xs truncate">
                            {item.apiKey ? item.apiKey.slice(0, 12) + '...' + item.apiKey.slice(-8) : "—"}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{item.proxyURL || "—"}</TableCell>
                        <TableCell>
                            <Chip color={item.enabled ? "success" : "default"} size="sm" variant="flat">
                                {item.enabled ? locale.Yes : locale.No}
                            </Chip>
                        </TableCell>
                        <TableCell>
                            <div className="flex flex-row gap-2">
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
