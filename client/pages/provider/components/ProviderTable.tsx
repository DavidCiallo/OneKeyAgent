import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Button, Chip, Checkbox } from "@heroui/react";
import { ProviderDTO } from "../../../../shared/modules/provider/provider.interface";
import { Locale } from "../../../methods/locale";

type Props = {
    list: ProviderDTO[];
    onEdit: (item: ProviderDTO) => void;
    onCopy: (item: ProviderDTO) => void;
    onDelete: (id: string) => void;
    onMoveUp: (item: ProviderDTO) => void;
    onMoveDown: (item: ProviderDTO) => void;
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
    onToggleSelectAll: () => void;
};

export function ProviderTable({ list, onEdit, onCopy, onDelete, onMoveUp, onMoveDown, selectedIds, onToggleSelect, onToggleSelectAll }: Props) {
    const locale = Locale("ProviderPage");
    const allSelected = list.length > 0 && list.every(item => selectedIds.has(item.id));

    return (
        <Table aria-label="Provider list" className="flex-1 overflow-auto">
            <TableHeader>
                <TableColumn align="center" className="w-10">
                    <Checkbox
                        isSelected={allSelected}
                        onChange={onToggleSelectAll}
                        aria-label="Select all"
                    />
                </TableColumn>
                <TableColumn align="center">{locale.ModelAlias}</TableColumn>
                <TableColumn align="center">{locale.Priority}</TableColumn>
                <TableColumn>{locale.Name}</TableColumn>
                <TableColumn className="min-w-40">{locale.BaseURL}</TableColumn>
                <TableColumn align="center">{locale.Model}</TableColumn>
                <TableColumn align="center">{locale.AuthType}</TableColumn>
                <TableColumn align="center">{locale.ApiType}</TableColumn>
                <TableColumn align="center">{locale.ApiKey}</TableColumn>
                <TableColumn align="center">{locale.ProxyURL}</TableColumn>
                <TableColumn align="center">{locale.SupportsThinking}</TableColumn>
                <TableColumn align="center">{locale.SupportsReasoningEffort}</TableColumn>
                <TableColumn align="center">{locale.Enabled}</TableColumn>
                <TableColumn>{locale.Actions}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={locale.NoData}>
                {list.map((item) => {
                    return (
                        <TableRow key={item.id}>
                            <TableCell>
                                <Checkbox
                                    isSelected={selectedIds.has(item.id)}
                                    onChange={() => onToggleSelect(item.id)}
                                    aria-label={`Select ${item.model_alias}`}
                                />
                            </TableCell>
                            <TableCell>{item.model_alias}</TableCell>
                            <TableCell>{item.priority}</TableCell>
                            <TableCell className="max-w-xs truncate">{item.name}</TableCell>
                            <TableCell className="max-w-xs truncate">{item.base_url}</TableCell>
                            <TableCell>{item.model}</TableCell>
                            <TableCell>
                                <Chip size="sm" variant="flat">
                                    {item.auth_type || "bearer"}
                                </Chip>
                            </TableCell>
                            <TableCell>
                                <Chip size="sm" variant="flat">
                                    {item.api_type || "openai"}
                                </Chip>
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                                {item.api_key ? item.api_key.slice(0, 8) + '...' + item.api_key.slice(-8) : "—"}
                            </TableCell>
                            <TableCell className="max-w-xs truncate">
                                {item.proxy_url ? item.proxy_url.slice(0, 12) + '...' + item.proxy_url.slice(-8) : "—"}
                            </TableCell>
                            <TableCell>
                                <Chip color={item.supports_thinking ? "secondary" : "default"} size="sm" variant="flat">
                                    {item.supports_thinking ? locale.Yes : locale.No}
                                </Chip>
                            </TableCell>
                            <TableCell>
                                <Chip color={item.supports_reasoning_effort ? "secondary" : "default"} size="sm" variant="flat">
                                    {item.supports_reasoning_effort ? locale.Yes : locale.No}
                                </Chip>
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
                                            className="text-gray-400 hover:text-gray-700 p-0.5"
                                            onClick={() => onMoveUp(item)}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M18 15l-6-6-6 6"/>
                                            </svg>
                                        </button>
                                        <button
                                            className="text-gray-400 hover:text-gray-700 p-0.5"
                                            onClick={() => onMoveDown(item)}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M6 9l6 6 6-6"/>
                                            </svg>
                                        </button>
                                    </div>
                                    <Button size="sm" variant="flat" className="min-w-0 px-2" onPress={() => onCopy(item)}>
                                        {locale.Copy}
                                    </Button>
                                    <Button size="sm" variant="flat" className="min-w-0 px-2" onPress={() => onEdit(item)}>
                                        {locale.Edit}
                                    </Button>
                                    <Button size="sm" variant="flat" color="danger" className="min-w-0 px-2" onPress={() => onDelete(item.id)}>
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
