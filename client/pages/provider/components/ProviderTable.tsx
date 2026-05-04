import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Button, Chip } from "@heroui/react";
import { ProviderDTO } from "../../../../shared/modules/provider/provider.interface";
import { Locale } from "../../../methods/locale";

type Props = {
    list: ProviderDTO[];
    onEdit: (item: ProviderDTO) => void;
    onCopy: (item: ProviderDTO) => void;
    onDelete: (id: string) => void;
    onMoveUp: (item: ProviderDTO, prev: ProviderDTO | undefined) => void;
    onMoveDown: (item: ProviderDTO, next: ProviderDTO | undefined) => void;
};

export function ProviderTable({ list, onEdit, onCopy, onDelete, onMoveUp, onMoveDown }: Props) {
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
                {list.map((item, i) => {
                    const prev = i > 0 ? list[i - 1] : undefined;
                    const next = i < list.length - 1 ? list[i + 1] : undefined;

                    return (
                        <TableRow key={item.id}>
                            <TableCell>{item.modelAlias}</TableCell>
                            <TableCell>{item.priority}</TableCell>
                            <TableCell className="max-w-xs truncate">{item.name}</TableCell>
                            <TableCell className="max-w-xs truncate">{item.baseURL}</TableCell>
                            <TableCell>{item.model}</TableCell>
                            <TableCell className="max-w-xs truncate">
                                {item.apiKey ? item.apiKey.slice(0, 8) + '...' + item.apiKey.slice(-8) : "—"}
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                                {item.proxyURL ? item.proxyURL.slice(0, 12) + '...' + item.proxyURL.slice(-8) : "—"}
                            </TableCell>
                            <TableCell>
                                <Chip color={item.enabled ? "success" : "default"} size="sm" variant="flat">
                                    {item.enabled ? locale.Yes : locale.No}
                                </Chip>
                            </TableCell>
                            <TableCell>
                                <div className="flex flex-row gap-3">
                                    <div className="flex flex-row gap-1 items-center">
                                        <button
                                            className="text-gray-400 hover:text-gray-700 disabled:opacity-30 p-0.5"
                                            disabled={!prev}
                                            onClick={() => onMoveUp(item, prev)}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M18 15l-6-6-6 6"/>
                                            </svg>
                                        </button>
                                        <button
                                            className="text-gray-400 hover:text-gray-700 disabled:opacity-30 p-0.5"
                                            disabled={!next}
                                            onClick={() => onMoveDown(item, next)}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M6 9l6 6 6-6"/>
                                            </svg>
                                        </button>
                                    </div>
                                    <Button size="sm" variant="flat" onPress={() => onCopy(item)}>
                                        {locale.Copy}
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
                    );
                })}
            </TableBody>
        </Table>
    );
}
