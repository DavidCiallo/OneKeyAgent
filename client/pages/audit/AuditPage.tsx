import { Header } from "../../components/header/Header";
import { useEffect, useMemo, useState, useCallback } from "react";
import { AuditDTO } from "../../../shared/modules/audit/audit.interface";
import { auditApi } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { Button, Chip, Tab, Tabs } from "@heroui/react";

type Outcome = "success" | "failed";

function formatTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(ms: number): string {
    if (ms <= 0) return "-";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(cost: number): string {
    if (!cost) return "-";
    return `$${cost.toFixed(6)}`;
}

/** HTTP status → chip color, so failures read at a glance. */
function statusColor(code: number): "success" | "warning" | "danger" | "default" {
    if (code === 200) return "success";
    if (code === 429) return "warning";
    if (code >= 400) return "danger";
    return "default";
}

export default function AuditPage() {
    const locale = Locale("AuditPage");
    const [tab, setTab] = useState<Outcome>("success");
    const [list, setList] = useState<AuditDTO[]>([]);
    const [keep, setKeep] = useState(100);
    const [loading, setLoading] = useState(true);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const fetchList = useCallback(async (showSpinner: boolean) => {
        if (showSpinner) setLoading(true);
        const res = await auditApi.list({});
        if (res.success && res.data) {
            setList(res.data.list);
            setKeep(res.data.keep);
        }
        if (showSpinner) setLoading(false);
    }, []);

    useEffect(() => {
        fetchList(true);
    }, [fetchList]);

    // Live view: poll while the tab is visible so an in-flight debug session
    // shows new attempts without a manual refresh.
    useEffect(() => {
        if (!autoRefresh) return;
        const timer = setInterval(() => {
            if (document.visibilityState === "visible") fetchList(false);
        }, 5000);
        return () => clearInterval(timer);
    }, [autoRefresh, fetchList]);

    const { successRows, failedRows } = useMemo(() => ({
        successRows: list.filter(r => r.success === 1),
        failedRows: list.filter(r => r.success !== 1),
    }), [list]);

    const rows = tab === "success" ? successRows : failedRows;

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={locale.Title || "Audit"} />
            <div className="p-6 flex flex-col gap-4 flex-1 overflow-auto">
                <div className="flex flex-row items-center justify-between flex-wrap gap-2">
                    <Tabs
                        selectedKey={tab}
                        onSelectionChange={(key) => setTab(key as Outcome)}
                        variant="underlined"
                    >
                        <Tab key="success" title={`${locale.Success || "Success"} (${successRows.length})`} />
                        <Tab key="failed" title={`${locale.Failed || "Failed"} (${failedRows.length})`} />
                    </Tabs>
                    <div className="flex flex-row items-center gap-3">
                        <label className="flex flex-row items-center gap-1 text-sm text-gray-600 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={(e) => setAutoRefresh(e.target.checked)}
                            />
                            {locale.AutoRefresh || "Auto refresh"}
                        </label>
                        <Button size="sm" variant="flat" isLoading={loading} onPress={() => fetchList(true)}>
                            {locale.Refresh || "Refresh"}
                        </Button>
                    </div>
                </div>

                <p className="text-xs text-gray-500">
                    {(locale.KeepHint || "Keeps the latest {n} records per outcome.").replace("{n}", String(keep))}
                </p>

                <div className="flex-1 overflow-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr className="text-left text-gray-600">
                                <th className="px-3 py-2 font-medium">{locale.Time || "Time"}</th>
                                <th className="px-3 py-2 font-medium">{locale.Account || "Account"}</th>
                                <th className="px-3 py-2 font-medium">{locale.Model || "Model"}</th>
                                <th className="px-3 py-2 font-medium">{locale.Provider || "Provider"}</th>
                                <th className="px-3 py-2 font-medium">{locale.Endpoint || "Endpoint"}</th>
                                <th className="px-3 py-2 font-medium">{locale.Status || "Status"}</th>
                                <th className="px-3 py-2 font-medium">{locale.Duration || "Duration"}</th>
                                <th className="px-3 py-2 font-medium">{locale.Tokens || "Tokens"}</th>
                                <th className="px-3 py-2 font-medium">{locale.Cost || "Cost"}</th>
                                {tab === "failed" && <th className="px-3 py-2 font-medium">{locale.Error || "Error"}</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {loading && rows.length === 0 ? (
                                <tr><td colSpan={tab === "failed" ? 10 : 9} className="px-3 py-6 text-center text-gray-400">Loading...</td></tr>
                            ) : rows.length === 0 ? (
                                <tr><td colSpan={tab === "failed" ? 10 : 9} className="px-3 py-6 text-center text-gray-400">{locale.NoData || "No data"}</td></tr>
                            ) : rows.map(r => (
                                <tr key={r.id} className="border-t border-gray-100 align-top">
                                    <td className="px-3 py-2 whitespace-nowrap">{formatTime(r.ts)}</td>
                                    <td className="px-3 py-2">{r.account_name || r.account_id || "-"}</td>
                                    <td className="px-3 py-2">{r.model_alias || "-"}</td>
                                    <td className="px-3 py-2">
                                        {r.provider_name || "-"}
                                        {r.api_type ? <span className="ml-1 text-xs text-gray-400">{r.api_type}</span> : null}
                                        {r.stream ? <span className="ml-1 text-xs text-gray-400">stream</span> : null}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{r.endpoint || "-"}</td>
                                    <td className="px-3 py-2">
                                        <Chip size="sm" variant="flat" color={statusColor(r.status_code)}>
                                            {r.status_code || "-"}
                                        </Chip>
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">{formatDuration(r.duration_ms)}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">
                                        {r.input_tokens || 0}/{r.cached_input_tokens || 0}/{r.output_tokens || 0}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">{formatCost(r.cost)}</td>
                                    {tab === "failed" && (
                                        <td className="px-3 py-2 text-xs text-red-600 max-w-md break-all">{r.err || "-"}</td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
