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
    Input,
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

    // Filter
    const [filterApiKey, setFilterApiKey] = useState("");
    const [filterSessionId, setFilterSessionId] = useState("");
    const [filterModelId, setFilterModelId] = useState("");

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchList = useCallback(async (p: number) => {
        const filter: Record<string, string> = {};
        if (filterApiKey) filter.apiKey = filterApiKey;
        if (filterSessionId) filter.sessionId = filterSessionId;
        if (filterModelId) filter.modelId = filterModelId;

        const req = new UsageListRequest({ page: p, filter: new UsageQueryBody(filter), auth: getToken() });
        const res = await UsageRouter.list(req);
        if (res.success && res.data) {
            setList(res.data.list);
            setTotal(res.data.total);
        }
    }, [filterApiKey, filterSessionId, filterModelId]);

    useEffect(() => {
        fetchList(page);
    }, [page, fetchList]);

    const totalPages = Math.ceil(total / 10) || 1;

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={Locale("Menu").Usage} />
            <div className="p-8 flex flex-col gap-4 flex-1 overflow-hidden">
                {/* Filters */}
                <div className="flex flex-row gap-3 items-end flex-wrap">
                    <Input
                        label={locale.ApiKey}
                        placeholder={locale.ApiKeyPlaceholder}
                        value={filterApiKey}
                        onChange={e => { setFilterApiKey(e.target.value); setPage(1); }}
                        className="w-64"
                        size="sm"
                    />
                    <Input
                        label={locale.SessionId}
                        placeholder={locale.SessionIdPlaceholder}
                        value={filterSessionId}
                        onChange={e => { setFilterSessionId(e.target.value); setPage(1); }}
                        className="w-48"
                        size="sm"
                    />
                    <Input
                        label={locale.ModelId}
                        placeholder={locale.ModelIdPlaceholder}
                        value={filterModelId}
                        onChange={e => { setFilterModelId(e.target.value); setPage(1); }}
                        className="w-48"
                        size="sm"
                    />
                </div>

                {/* Table */}
                <Table
                    aria-label="Usage list"
                    className="flex-1 overflow-auto"
                >
                    <TableHeader>
                        <TableColumn>{locale.ApiKey}</TableColumn>
                        <TableColumn>{locale.SessionId}</TableColumn>
                        <TableColumn>{locale.ModelId}</TableColumn>
                        <TableColumn align="center">{locale.InputTokens}</TableColumn>
                        <TableColumn align="center">{locale.OutputTokens}</TableColumn>
                        <TableColumn>{locale.Time}</TableColumn>
                    </TableHeader>
                    <TableBody emptyContent={locale.NoData}>
                        {list.map(item => (
                            <TableRow key={item.id}>
                                <TableCell className="max-w-xs truncate">{item.apiKey || "—"}</TableCell>
                                <TableCell className="max-w-xs truncate">{item.sessionId || "—"}</TableCell>
                                <TableCell className="max-w-xs truncate">{item.modelId || "—"}</TableCell>
                                <TableCell align="center">{item.inputTokens}</TableCell>
                                <TableCell align="center">{item.outputTokens}</TableCell>
                                <TableCell>{item.create_time ? new Date(item.create_time).toLocaleString() : "—"}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>

                {/* Pagination */}
                <div className="flex justify-center">
                    <Pagination
                        total={totalPages}
                        page={page}
                        onChange={setPage}
                        showControls
                    />
                </div>
            </div>
        </div>
    );
}
