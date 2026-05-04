import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import {
    UserSessionGroup,
    UsageSessionsRequest,
    UsageDTO,
    UsageListRequest,
    UsageQueryBody,
} from "../../../shared/modules/usage/usage.interface";
import { UsageRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { Tabs, Tab } from "@heroui/react";
import { UsageTable } from "./components/UsageTable";
import { UsageSessions } from "./components/UsageSessions";

export default function UsagePage() {
    const locale = Locale("UsagePage");

    const [viewMode, setViewMode] = useState<"sessions" | "history">("sessions");

    const [list, setList] = useState<UsageDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    const [groups, setGroups] = useState<UserSessionGroup[]>([]);

    const [loading, setLoading] = useState(true);

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchList = useCallback(async (p: number) => {
        setLoading(true);
        const req = new UsageListRequest({ page: p, filter: new UsageQueryBody({}), auth: getToken() });
        const res = await UsageRouter.list(req);
        if (res.success && res.data) {
            setList(res.data.list);
            setTotal(res.data.total);
        }
        setLoading(false);
    }, []);

    const fetchSessions = useCallback(async () => {
        setLoading(true);
        const req = new UsageSessionsRequest({ auth: getToken() });
        const res = await UsageRouter.sessions(req);
        if (res.success && res.data) {
            setGroups(res.data);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        if (viewMode === "history") {
            fetchList(page);
        } else {
            fetchSessions();
        }
    }, [viewMode, page, fetchList, fetchSessions]);

    return (
        <div className="max-w-screen flex flex-col min-h-screen">
            <Header name={Locale("Menu").Usage} />
            <div className="p-3 sm:p-8 flex flex-col gap-4 flex-1 overflow-auto">
                <div className="flex justify-center">
                    <Tabs
                        selectedKey={viewMode}
                        onSelectionChange={(key) => {
                            setViewMode(key as "sessions" | "history");
                            setPage(1);
                        }}
                        aria-label="Usage view mode"
                    >
                        <Tab key="sessions" title={locale.UserUsage} />
                        <Tab key="history" title={locale.History || "History"} />
                    </Tabs>
                </div>

                {loading ? (
                    <div className="text-center text-default-400 py-12">{locale.Loading || "Loading..."}</div>
                ) : viewMode === "history" ? (
                    <UsageTable list={list} total={total} page={page} onPageChange={setPage} />
                ) : (
                    <UsageSessions groups={groups} />
                )}
            </div>
        </div>
    );
}