import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import {
    UsageSessionTotals,
    UserSessionGroup,
    UserSession,
} from "../../../shared/modules/usage/usage.interface";
import { usageApi, accountApi, providerApi, modelApi } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { Select, SelectItem, Button, ButtonGroup, Badge } from "@heroui/react";
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
    { value: 30, label: "30d" },
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
    const [totals, setTotals] = useState<UsageSessionTotals>({ totalTokens: 0, totalInputTokens: 0, totalCachedInputTokens: 0, totalOutputTokens: 0, totalCost: 0, totalRequests: 0 });
    const [recentSessions, setRecentSessions] = useState<UserSession[]>([]);
    const [gapMinutes, setGapMinutes] = useState(60);
    const [timePreset, setTimePreset] = useState<number>(0);
    const [accounts, setAccounts] = useState<{ id: string; name: string; email: string }[]>([]);
    const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
    const [modelAliases, setModelAliases] = useState<string[]>([]);

    // Draft selections (not yet applied)
    const [draftAccountIds, setDraftAccountIds] = useState<Set<string>>(new Set());
    const [draftModelAliases, setDraftModelAliases] = useState<Set<string>>(new Set());
    const [draftProviderIds, setDraftProviderIds] = useState<Set<string>>(new Set());

    // Applied selections (sent to server)
    const [appliedAccountIds, setAppliedAccountIds] = useState<Set<string>>(new Set());
    const [appliedModelAliases, setAppliedModelAliases] = useState<Set<string>>(new Set());
    const [appliedProviderIds, setAppliedProviderIds] = useState<Set<string>>(new Set());

    const [loading, setLoading] = useState(true);
    const admin = isAdmin();
    const [groupBy, setGroupBy] = useState<"provider" | "model">(admin ? "provider" : "model");
    const [valueType, setValueType] = useState<"tokens" | "cost">("tokens");

    const filterCount = appliedAccountIds.size + appliedModelAliases.size + appliedProviderIds.size;

    const hasDraftChanges =
        !setsEqual(draftAccountIds, appliedAccountIds) ||
        !setsEqual(draftModelAliases, appliedModelAliases) ||
        !setsEqual(draftProviderIds, appliedProviderIds);

    // Fetch accounts list for admin selector
    useEffect(() => {
        if (!admin) return;
        accountApi.list({ page: 1, filter: {} }).then((res) => {
            if (res.success && res.data) {
                const totalPages = Math.ceil(res.data.total / 40);
                if (totalPages <= 1) {
                    setAccounts(res.data.list.map((a: any) => ({ id: a.id, name: a.name, email: a.email })));
                } else {
                    Promise.all(
                        Array.from({ length: totalPages - 1 }, (_, i) =>
                            accountApi.list({ page: i + 2, filter: {} })
                        )
                    ).then((pages) => {
                        const all = [res.data.list, ...pages.map((p: any) => p.data?.list || [])].flat();
                        setAccounts(all.map((a: any) => ({ id: a.id, name: a.name, email: a.email })));
                    });
                }
            }
        });
    }, [admin]);

    // Fetch providers list
    useEffect(() => {
        providerApi.list({ page: 1, filter: {} }).then((res) => {
            if (res.success && res.data) {
                setProviders(res.data.list.map((p: any) => ({ id: p.id, name: p.name })));
            }
        });
    }, []);

    // Fetch model aliases list
    useEffect(() => {
        modelApi.list({ page: 1, filter: {} }).then((res) => {
            if (res.success && res.data) {
                const aliases = [...new Set(res.data.list.map((m: any) => m.alias))] as string[];
                setModelAliases(aliases.sort());
            }
        });
    }, []);

    const fetchSessions = useCallback(async (
        gap: number, preset: number,
        accountIds: Set<string>, modelAliases: Set<string>, providerIds: Set<string>,
    ) => {
        setLoading(true);
        const since = computeSince(preset);
        const res = await usageApi.sessions({
            gapMinutes: gap,
            since,
            account_ids: accountIds.size > 0 ? Array.from(accountIds) : undefined,
            model_aliases: modelAliases.size > 0 ? Array.from(modelAliases) : undefined,
            provider_ids: providerIds.size > 0 ? Array.from(providerIds) : undefined,
        });
        if (res.success && res.data) {
            setGroups(res.data.list);
            setTotals(res.data.totals);
            setRecentSessions(res.data.recentSessions || []);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchSessions(gapMinutes, timePreset, appliedAccountIds, appliedModelAliases, appliedProviderIds);
    }, [gapMinutes, timePreset, appliedAccountIds, appliedModelAliases, appliedProviderIds, fetchSessions]);

    const applyFilters = () => {
        setAppliedAccountIds(new Set(draftAccountIds));
        setAppliedModelAliases(new Set(draftModelAliases));
        setAppliedProviderIds(new Set(draftProviderIds));
    };

    const clearFilters = () => {
        setDraftAccountIds(new Set());
        setDraftModelAliases(new Set());
        setDraftProviderIds(new Set());
        setAppliedAccountIds(new Set());
        setAppliedModelAliases(new Set());
        setAppliedProviderIds(new Set());
    };

    return (
        <div className="max-w-screen flex flex-col min-h-screen">
            <Header name={Locale("Menu").Usage} />
            <div className="p-3 md:p-12 flex flex-col gap-4 flex-1 overflow-auto">
                {loading ? (
                    <div className="text-center text-default-400 py-12">{locale.Loading || "Loading..."}</div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                            {admin && accounts.length > 0 && (
                                <Select
                                    size="sm"
                                    className="w-80"
                                    selectionMode="multiple"
                                    selectedKeys={draftAccountIds}
                                    onSelectionChange={(keys) => setDraftAccountIds(new Set(Array.from(keys).map(String)))}
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
                            {providers.length > 0 && (
                                <Select
                                    size="sm"
                                    className="w-60"
                                    selectionMode="multiple"
                                    selectedKeys={draftProviderIds}
                                    onSelectionChange={(keys) => setDraftProviderIds(new Set(Array.from(keys).map(String)))}
                                    placeholder="Filter providers"
                                    aria-label="Filter providers"
                                    renderValue={(items) => {
                                        const selected = Array.from(items);
                                        if (selected.length === 0) return <span className="text-default-400">Filter providers</span>;
                                        if (selected.length === 1) {
                                            const p = providers.find(pr => pr.id === selected[0].key);
                                            return <span>{p?.name || selected[0].textValue || selected[0].key}</span>;
                                        }
                                        return <span>{selected.length} providers</span>;
                                    }}
                                >
                                    {providers.map((p) => (
                                        <SelectItem key={p.id}>{p.name}</SelectItem>
                                    ))}
                                </Select>
                            )}
                            {modelAliases.length > 0 && (
                                <Select
                                    size="sm"
                                    className="w-60"
                                    selectionMode="multiple"
                                    selectedKeys={draftModelAliases}
                                    onSelectionChange={(keys) => setDraftModelAliases(new Set(Array.from(keys).map(String)))}
                                    placeholder="Filter models"
                                    aria-label="Filter models"
                                    renderValue={(items) => {
                                        const selected = Array.from(items);
                                        if (selected.length === 0) return <span className="text-default-400">Filter models</span>;
                                        if (selected.length === 1) return <span>{selected[0].textValue || selected[0].key}</span>;
                                        return <span>{selected.length} models</span>;
                                    }}
                                >
                                    {modelAliases.map((alias) => (
                                        <SelectItem key={alias}>{alias}</SelectItem>
                                    ))}
                                </Select>
                            )}
                            {(admin && accounts.length > 0 || providers.length > 0 || modelAliases.length > 0) && (
                                <div className="flex items-center gap-2">
                                    <Badge
                                        content={filterCount}
                                        color="primary"
                                        isInvisible={filterCount === 0}
                                        size="sm"
                                    >
                                        <Button
                                            size="sm"
                                            color={hasDraftChanges ? "primary" : "default"}
                                            variant={hasDraftChanges ? "solid" : "flat"}
                                            onPress={applyFilters}
                                            isDisabled={!hasDraftChanges && filterCount === 0}
                                        >
                                            Filter
                                        </Button>
                                    </Badge>
                                    <Button size="sm" variant="flat" onPress={clearFilters} isDisabled={filterCount === 0 && !hasDraftChanges}>
                                        Clear
                                    </Button>
                                </div>
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
                            {admin && (
                                <ButtonGroup size="sm" variant="flat">
                                    <Button
                                        color={groupBy === "provider" ? "primary" : "default"}
                                        onPress={() => setGroupBy("provider")}
                                    >
                                        Provider
                                    </Button>
                                    <Button
                                        color={groupBy === "model" ? "primary" : "default"}
                                        onPress={() => setGroupBy("model")}
                                    >
                                        Model
                                    </Button>
                                </ButtonGroup>
                            )}
                            <ButtonGroup size="sm" variant="flat">
                                <Button
                                    color={valueType === "tokens" ? "primary" : "default"}
                                    onPress={() => setValueType("tokens")}
                                >
                                    Tokens
                                </Button>
                                <Button
                                    color={valueType === "cost" ? "primary" : "default"}
                                    onPress={() => setValueType("cost")}
                                >
                                    Cost
                                </Button>
                            </ButtonGroup>
                        </div>
                        <UsageSessions groups={groups} totals={totals} recentSessions={recentSessions} gapMinutes={gapMinutes} isAdmin={admin} groupBy={groupBy} valueType={valueType} />
                    </div>
                )}
            </div>
        </div>
    );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
}
