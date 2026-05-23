import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import {
    UsageSessionsRequest,
    UsageSessionTotals,
    UserSessionGroup,
    UserSession,
} from "../../../shared/modules/usage/usage.interface";
import { UsageRouter, AccountRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { Select, SelectItem, Button, ButtonGroup } from "@heroui/react";
import { useAuth } from "../../methods/auth-context";
import { UsageSessions } from "./components/UsageSessions";

const GAP_OPTIONS = [
    { value: 1, label: "1min" },
    { value: 15, label: "15min" },
    { value: 30, label: "30min" },
    { value: 60, label: "1h" },
    { value: 360, label: "6h" },
    { value: 720, label: "12h" },
    { value: 1440, label: "1d" },
];

const TIME_PRESETS = [
    { value: 0, label: "Today" },
    { value: 1, label: "24h" },
    { value: 3, label: "3d" },
    { value: 7, label: "7d" },
] as const;

function computeSince(preset: number): number {
    const now = Date.now();
    if (preset === 0) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }
    return now - preset * 86400000;
}

export default function UsagePage() {
    const locale = Locale("UsagePage");
    const { isAdmin } = useAuth();

    const [groups, setGroups] = useState<UserSessionGroup[]>([]);
    const [totals, setTotals] = useState<UsageSessionTotals>({ totalTokens: 0, totalCost: 0, totalRequests: 0 });
    const [recentSessions, setRecentSessions] = useState<UserSession[]>([]);
    const [gapMinutes, setGapMinutes] = useState(60);
    const [timePreset, setTimePreset] = useState<number>(0);
    const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
    const [accounts, setAccounts] = useState<{ id: string; name: string; email: string }[]>([]);

    const [loading, setLoading] = useState(true);

    const getToken = () => localStorage.getItem("access_token") || "";

    // Fetch accounts list for admin selector
    useEffect(() => {
        if (!isAdmin()) return;
        AccountRouter.list({ auth: getToken(), page: 1, filter: {} }).then((res) => {
            if (res.success && res.data) {
                // Fetch all pages to get all accounts
                const totalPages = Math.ceil(res.data.total / 40);
                if (totalPages <= 1) {
                    setAccounts(res.data.list.map((a: any) => ({ id: a.id, name: a.name, email: a.email })));
                } else {
                    Promise.all(
                        Array.from({ length: totalPages - 1 }, (_, i) =>
                            AccountRouter.list({ auth: getToken(), page: i + 2, filter: {} })
                        )
                    ).then((pages) => {
                        const all = [res.data.list, ...pages.map((p: any) => p.data?.list || [])].flat();
                        setAccounts(all.map((a: any) => ({ id: a.id, name: a.name, email: a.email })));
                    });
                }
            }
        });
    }, [isAdmin]);

    const fetchSessions = useCallback(async (gap: number, preset: number, ids: Set<string>) => {
        setLoading(true);
        const since = computeSince(preset);
        const req = new UsageSessionsRequest({
            auth: getToken(),
            gapMinutes: gap,
            since,
            account_ids: ids.size > 0 ? Array.from(ids) : undefined,
        });
        const res = await UsageRouter.sessions(req);
        if (res.success && res.data) {
            setGroups(res.data);
            setTotals(res.totals);
            setRecentSessions(res.recentSessions || []);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchSessions(gapMinutes, timePreset, selectedAccountIds);
    }, [gapMinutes, timePreset, selectedAccountIds, fetchSessions]);

    return (
        <div className="max-w-screen flex flex-col min-h-screen">
            <Header name={Locale("Menu").Usage} />
            <div className="p-3 md:p-12 flex flex-col gap-4 flex-1 overflow-auto">
                {loading ? (
                    <div className="text-center text-default-400 py-12">{locale.Loading || "Loading..."}</div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                            {isAdmin() && accounts.length > 0 && (
                                <Select
                                    size="sm"
                                    className="w-80"
                                    selectionMode="multiple"
                                    selectedKeys={selectedAccountIds}
                                    onSelectionChange={(keys) => setSelectedAccountIds(new Set(Array.from(keys).map(String)))}
                                    placeholder="Filter accounts"
                                    aria-label="Filter accounts"
                                    renderValue={(items) => {
                                        const selected = Array.from(items);
                                        if (selected.length === 0) return <span className="text-default-400">Filter accounts</span>;
                                        if (selected.length === 1) {
                                            const a = accounts.find(ac => ac.id === selected[0].key);
                                            return <span>{a ? `${a.name} (${a.email})` : selected[0].textValue || selected[0].key}</span>;
                                        }
                                        return <span>{selected.length} accounts</span>;
                                    }}
                                >
                                    {accounts.map((a) => (
                                        <SelectItem key={a.id}>{a.name} ({a.email})</SelectItem>
                                    ))}
                                </Select>
                            )}
                            <Select
                                size="sm"
                                className="w-28"
                                selectedKeys={[String(gapMinutes)]}
                                onSelectionChange={(keys) => {
                                    const val = Number(Array.from(keys)[0]);
                                    if (val) setGapMinutes(val);
                                }}
                                aria-label="Aggregation interval"
                            >
                                {GAP_OPTIONS.map((opt) => (
                                    <SelectItem key={String(opt.value)}>{opt.label}</SelectItem>
                                ))}
                            </Select>
                            <ButtonGroup size="sm" variant="flat">
                                {TIME_PRESETS.map((p) => (
                                    <Button
                                        key={p.value}
                                        color={timePreset === p.value ? "primary" : "default"}
                                        onPress={() => setTimePreset(p.value)}
                                    >
                                        {p.label}
                                    </Button>
                                ))}
                            </ButtonGroup>
                        </div>
                        <UsageSessions groups={groups} totals={totals} recentSessions={recentSessions} gapMinutes={gapMinutes} />
                    </div>
                )}
            </div>
        </div>
    );
}