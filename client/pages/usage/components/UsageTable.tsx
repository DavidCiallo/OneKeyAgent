import {
    Table,
    TableHeader,
    TableColumn,
    TableBody,
    TableRow,
    TableCell,
    Pagination,
} from "@heroui/react";
import { UsageDTO } from "../../../../shared/modules/usage/usage.interface";
import { Locale } from "../../../methods/locale";
import { stripEmail } from "./utils";

type Props = {
    list: UsageDTO[];
    total: number;
    page: number;
    onPageChange: (page: number) => void;
};

export function UsageTable({ list, total, page, onPageChange }: Props) {
    const locale = Locale("UsagePage");
    const totalPages = Math.ceil(total / 40) || 1;

    return (
        <>
            <div className="flex flex-row flex-1 overflow-auto">
                <Table aria-label="Usage list" className="flex-1">
                    <TableHeader>
                        <TableColumn>{locale.AccountId}</TableColumn>
                        <TableColumn align="center">{locale.ModelAlias}</TableColumn>
                        <TableColumn align="center">{locale.ProviderName}</TableColumn>
                        <TableColumn align="center">{locale.InputTokens}</TableColumn>
                        <TableColumn align="center">{locale.OutputTokens}</TableColumn>
                        <TableColumn align="center">Requests</TableColumn>
                        <TableColumn align="center">{locale.Time}</TableColumn>
                    </TableHeader>
                    <TableBody emptyContent={locale.NoData}>
                        {list.map(item => (
                            <TableRow key={item.id}>
                                <TableCell className="max-w-xs truncate">{stripEmail(item.accountName || "") || item.accountId || "—"}</TableCell>
                                <TableCell>{item.modelAlias || "—"}</TableCell>
                                <TableCell>{item.providerName || "—"}</TableCell>
                                <TableCell>{item.inputTokens}</TableCell>
                                <TableCell>{item.outputTokens}</TableCell>
                                <TableCell>1</TableCell>
                                <TableCell>{item.create_time ? new Date(item.create_time).toLocaleString() : "—"}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <div className="flex justify-center">
                <Pagination total={totalPages} page={page} onChange={onPageChange} showControls />
            </div>
        </>
    );
}