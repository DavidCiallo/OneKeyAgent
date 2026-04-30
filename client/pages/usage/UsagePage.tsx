import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { UsageDTO } from "../../../shared/modules/usage/usage.interface";
import { UsageRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import {
    Table,
    TableHeader,
    TableColumn,
    TableBody,
    TableRow,
    TableCell,
    Pagination,
} from "@heroui/react";
import {
    UsageListRequest,
    UsageQueryBody,
} from "../../../shared/modules/usage/usage.interface";

export default function UsagePage() {
    const locale = Locale("UsagePage");

    const [list, setList] = useState<UsageDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchList = useCallback(async (p: number) => {
        const req = new UsageListRequest({ page: p, filter: new UsageQueryBody({}), auth: getToken() });
        const res = await UsageRouter.list(req);
        if (res.success && res.data) {
            setList(res.data.list);
            setTotal(res.data.total);
        }
    }, []);

    useEffect(() => {
        fetchList(page);
    }, [page, fetchList]);

    const totalPages = Math.ceil(total / 40) || 1;

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={Locale("Menu").Usage} />
            <div className="p-8 flex flex-col gap-4 flex-1 overflow-hidden">
                <div className="flex flex-row">
                    <Table aria-label="Usage list 1" className="flex-1 overflow-auto">
                        <TableHeader>
                            <TableColumn>{locale.AccountId}</TableColumn>
                            <TableColumn align="center">{locale.ModelAlias}</TableColumn>
                            <TableColumn align="center">{locale.ProviderName}</TableColumn>
                            <TableColumn align="center">{locale.InputTokens}</TableColumn>
                            <TableColumn align="center">{locale.OutputTokens}</TableColumn>
                            <TableColumn align="center">{locale.Time}</TableColumn>
                        </TableHeader>
                        <TableBody emptyContent={locale.NoData}>
                            {list.slice(0, 20).map(item => (
                                <TableRow key={item.id}>
                                    <TableCell className="max-w-xs truncate">{item.accountName || item.accountId || "—"}</TableCell>
                                    <TableCell>{item.modelAlias || "—"}</TableCell>
                                    <TableCell>{item.providerName || "—"}</TableCell>
                                    <TableCell>{item.inputTokens}</TableCell>
                                    <TableCell>{item.outputTokens}</TableCell>
                                    <TableCell>{item.create_time ? new Date(item.create_time).toLocaleString() : "—"}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    {list.length > 20 && <Table aria-label="Usage list 2" className="flex-1 overflow-auto">
                        <TableHeader>
                            <TableColumn>{locale.AccountId}</TableColumn>
                            <TableColumn align="center">{locale.ModelAlias}</TableColumn>
                            <TableColumn align="center">{locale.ProviderName}</TableColumn>
                            <TableColumn align="center">{locale.InputTokens}</TableColumn>
                            <TableColumn align="center">{locale.OutputTokens}</TableColumn>
                            <TableColumn align="center">{locale.Time}</TableColumn>
                        </TableHeader>
                        <TableBody emptyContent={locale.NoData}>
                            {list.slice(20).map(item => (
                                <TableRow key={item.id}>
                                    <TableCell className="max-w-xs truncate">{item.accountName || item.accountId || "—"}</TableCell>
                                    <TableCell>{item.modelAlias || "—"}</TableCell>
                                    <TableCell>{item.providerName || "—"}</TableCell>
                                    <TableCell>{item.inputTokens}</TableCell>
                                    <TableCell>{item.outputTokens}</TableCell>
                                    <TableCell>{item.create_time ? new Date(item.create_time).toLocaleString() : "—"}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>}
                </div>

                <div className="flex justify-center">
                    <Pagination total={totalPages} page={page} onChange={setPage} showControls />
                </div>
            </div>
        </div>
    );
}
