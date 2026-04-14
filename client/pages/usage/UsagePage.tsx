import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { UsageDTO } from "../../../shared/modules/usage/usage.interface";
import { ModelDTO } from "../../../shared/modules/model/model.entity";
import { UsageRouter, ModelRouter } from "../../api/instance";
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
import { ModelListRequest } from "../../../shared/modules/model/model.interface";

export default function UsagePage() {
    const locale = Locale("UsagePage");

    const [list, setList] = useState<UsageDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    // Model name map
    const [modelMap, setModelMap] = useState<Record<string, string>>({});

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchModels = useCallback(async () => {
        const req = new ModelListRequest({ page: 1, auth: getToken() });
        const res = await ModelRouter.list(req);
        if (res.success && res.data) {
            const map: Record<string, string> = {};
            res.data.list.forEach((m: ModelDTO) => { map[m.id] = m.model; });
            setModelMap(map);
        }
    }, []);

    const fetchList = useCallback(async (p: number) => {
        const filter: Record<string, string> = {};

        const req = new UsageListRequest({ page: p, filter: new UsageQueryBody(filter), auth: getToken() });
        const res = await UsageRouter.list(req);
        if (res.success && res.data) {
            setList(res.data.list);
            setTotal(res.data.total);
        }
    }, []);

    useEffect(() => {
        fetchModels();
    }, [fetchModels]);

    useEffect(() => {
        fetchList(page);
    }, [page, fetchList]);

    const totalPages = Math.ceil(total / 30) || 1;

    const topList = list.slice(0, 15);
    const bottomList = list.slice(15, 30);

    const renderRow = (item: UsageDTO) => (
        <TableRow key={item.id}>
            <TableCell className="max-w-xs truncate">{item.apiKey || "—"}</TableCell>
            <TableCell className="max-w-xs truncate">{item.modelId ? (modelMap[item.modelId] || item.modelId) : "—"}</TableCell>
            <TableCell align="center">{item.inputTokens}</TableCell>
            <TableCell align="center">{item.outputTokens}</TableCell>
            <TableCell>{item.create_time ? new Date(item.create_time).toLocaleString() : "—"}</TableCell>
        </TableRow>
    );

    const tableHeader = (
        <TableHeader>
            <TableColumn>{locale.ApiKey}</TableColumn>
            <TableColumn align="center">{locale.Model}</TableColumn>
            <TableColumn align="center">{locale.InputTokens}</TableColumn>
            <TableColumn align="center">{locale.OutputTokens}</TableColumn>
            <TableColumn align="center">{locale.Time}</TableColumn>
        </TableHeader>
    );

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={Locale("Menu").Usage} />
            <div className="p-8 flex flex-col gap-4 flex-1 overflow-hidden">
                <div className="grid grid-cols-2 gap-4">
                    <Table
                        aria-label="Usage list top"
                        className="flex-1 overflow-auto"
                    >
                        {tableHeader}
                        <TableBody emptyContent={locale.NoData}>
                            {topList.map(renderRow)}
                        </TableBody>
                    </Table>

                    {bottomList.length > 0 && <Table
                        aria-label="Usage list bottom"
                        className="flex-1 overflow-auto"
                    >
                        {tableHeader}
                        <TableBody emptyContent="">
                            {bottomList.map(renderRow)}
                        </TableBody>
                    </Table>}
                </div>

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
