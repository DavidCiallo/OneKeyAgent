import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import {
    UsageSessionTotals,
    UserSessionGroup,
    UserSession,
} from "../../../shared/modules/usage/usage.interface";
import { usageApi, accountApi, providerApi, modelApi, groupApi } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { Select, SelectItem, Button, ButtonGroup, Badge } from "@heroui/react";
import { useAuth } from "../../methods/auth-context";
import { UsageSessions } from "./components/UsageSessions";
import { DateRangePicker, rangeToMs } from "./components/DateRangePicker";
import { StatsDate, statsToday } from "../../methods/timezone";

const GAP_OPTIONS = [
    { value: 1, label: "1min" },
    { value: 10, label: "10min" },
    { value: 60, label: "1h" },
    { value: 1440, label: "1d" },
];

export default function UsagePage() {
    const locale = Locale("UsagePage");
    const { isAdmin } = useAuth();

    const [groups, setGroups] = useState<UserSessionGroup[]>([]);
    const [totals, setTotals] = useState<UsageSessionTotals>({ totalTokens: 0, totalInputTokens: 0, totalCachedInputTokens: 0, totalOutputTokens: 0, totalCost: 0, totalRequests: 0 });
    const [recentSessions, setRecentSessions] = useState<UserSession[]>([]);
    const [gapMinutes, setGapMinutes] = useState(60);
    // Defaults to a single day. The range is inclusive of both ends and is
    // expressed as calendar dates on the stats clock, so "today" means the
    // operator's today rather than the browser's.
    const [rangeFrom, setRangeFrom] = useState<StatsDate>(() => statsToday());
    const [rangeTo, setRangeTo] = useState<StatsDate>(() => statsToday());
    const [accounts, setAccounts] = useState<{ id: string; name: string; email: string }[]>([]);
    const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
    const [modelAliases, setModelAliases] = useState<string[]>([]);
    // Available groups for the filter selector. Distinct from `groups`, which
    // holds the aggregated session rows returned by the API.
    const [groupOptions, setGroupOptions] = useState<{ id: string; name: string; member_count: number }[]>([]);

    // Draft selections (not yet applied)
    const [draftAccountIds, setDraftAccountIds] = useState<Set<string>>(new Set());
    const [draftModelAliases, setDraftModelAliases] = useState<Set<string>>(new Set());
    const [draftProviderIds, setDraftProviderIds] = useState<Set<string>>(new Set());
    const [draftGroupIds, setDraftGroupIds] = useState<Set<string>>(new Set());

    // Applied selections (sent to server)
    const [appliedAccountIds, setAppliedAccountIds] = useState<Set<string>>(new Set());
    const [appliedModelAliases, setAppliedModelAliases] = useState<Set<string>>(new Set());
    const [appliedProviderIds, setAppliedProviderIds] = useState<Set<string>>(new Set());
    const [appliedGroupIds, setAppliedGroupIds] = useState<Set<string>>(new Set());

    const [loading, setLoading] = useState(true);
    const admin = isAdmin();
    const [groupBy, setGroupBy] = useState<"provider" | "model">(admin ? "provider" : "model");
    const [valueType, setValueType] = useState<"tokens" | "cost">("tokens");

    const filterCount = appliedAccountIds.size + appliedModelAliases.size + appliedProviderIds.size + appliedGroupIds.size;

    const hasDraftChanges =
        !setsEqual(draftAccountIds, appliedAccountIds) ||
        !setsEqual(draftModelAliases, appliedModelAliases) ||
        !setsEqual(draftProviderIds, appliedProviderIds) ||
        !setsEqual(draftGroupIds, appliedGroupIds);

    // Fetch accounts list for admin selector
    useEffect(() => {
        if (!admin) return;
        accountApi.list({ page: 1, filter: {} }).then((res) => {
            if (res.success && res.data) {
                // account list paginates at 10/page — derive from actual page size
                const totalPages = Math.ceil(res.data.total / Math.max(res.data.list.length, 1));
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

    // Groups are an admin-only shortcut over the account filter: a non-admin
    // only ever sees their own traffic, so the tags would be meaningless.
    // Each group's members are fetched too, because a tag has to be able to
    // expand into the account selection it stands for.
    const [groupMembers, setGroupMembers] = useState<Record<string, string[]>>({});
    useEffect(() => {
        if (!admin) return;
        groupApi.list({}).then((res) => {
            if (!res.success || !res.data) return;
            const opts = res.data.list.map((g: any) => ({
                id: g.id, name: g.name, member_count: g.member_count ?? 0,
            }));
            setGroupOptions(opts);
            Promise.all(opts.map((g: { id: string }) =>
                groupApi.detail({ id: g.id }).then((d: any) =>
                    [g.id, (d?.data?.member_ids ?? []) as string[]] as const
                ).catch(() => [g.id, [] as string[]] as const)
            )).then((pairs) => {
                setGroupMembers(Object.fromEntries(pairs));
            });
        });
    }, [admin]);

    const fetchSessions = useCallback(async (
        gap: number, from: StatsDate, to: StatsDate,
        accountIds: Set<string>, modelAliases: Set<string>, providerIds: Set<string>,
        groupIds: Set<string>,
    ) => {
        setLoading(true);
        const { since, until } = rangeToMs(from, to);
        const res = await usageApi.sessions({
            gapMinutes: gap,
            since,
            // Sent even when it is in the future: the server treats it as the
            // exclusive end, and "today" ends at tomorrow's midnight, which is
            // still ahead of now at the moment of the request.
            until,
            account_ids: accountIds.size > 0 ? Array.from(accountIds) : undefined,
            model_aliases: modelAliases.size > 0 ? Array.from(modelAliases) : undefined,
            provider_ids: providerIds.size > 0 ? Array.from(providerIds) : undefined,
            group_ids: groupIds.size > 0 ? Array.from(groupIds) : undefined,
        });
        if (res.success && res.data) {
            setGroups(res.data.list);
            setTotals(res.data.totals);
            setRecentSessions(res.data.recentSessions || []);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchSessions(gapMinutes, rangeFrom, rangeTo, appliedAccountIds, appliedModelAliases, appliedProviderIds, appliedGroupIds);
    }, [gapMinutes, rangeFrom, rangeTo, appliedAccountIds, appliedModelAliases, appliedProviderIds, appliedGroupIds, fetchSessions]);

    const applyFilters = () => {
        setAppliedAccountIds(new Set(draftAccountIds));
        setAppliedModelAliases(new Set(draftModelAliases));
        setAppliedProviderIds(new Set(draftProviderIds));
        setAppliedGroupIds(new Set(draftGroupIds));
    };

    /**
     * Toggle a group as a shortcut over the account selection.
     *
     * Selecting a group adds its members to the account draft, so the group is
     * visible as the accounts it stands for and can be fine-tuned from there:
     * pick "support", then drop one person from the selection. Turning the group
     * off removes exactly the members it contributed and leaves any account that
     * was selected independently or through another group alone.
     */
    const toggleGroupTag = (groupId: string) => {
        const members = groupMembers[groupId] ?? [];
        const wasOn = draftGroupIds.has(groupId);
        setDraftGroupIds((prev) => {
            const next = new Set(prev);
            if (wasOn) next.delete(groupId); else next.add(groupId);
            return next;
        });
        setDraftAccountIds((prev) => {
            const next = new Set(prev);
            if (wasOn) {
                // Keep anyone another still-selected group also covers.
                const stillCovered = new Set<string>();
                for (const gid of draftGroupIds) {
                    if (gid === groupId) continue;
                    for (const m of groupMembers[gid] ?? []) stillCovered.add(m);
                }
                for (const m of members) {
                    if (!stillCovered.has(m)) next.delete(m);
                }
            } else {
                for (const m of members) next.add(m);
            }
            return next;
        });
    };

    const clearFilters = () => {
        setDraftAccountIds(new Set());
        setDraftModelAliases(new Set());
        setDraftProviderIds(new Set());
        setDraftGroupIds(new Set());
        setAppliedAccountIds(new Set());
        setAppliedModelAliases(new Set());
        setAppliedProviderIds(new Set());
        setAppliedGroupIds(new Set());
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
                                    // Group ids are shown as selected alongside the accounts
                                    // so a tag reads as on/off, even though the applied
                                    // filter is only ever the account set they expanded to.
                                    selectedKeys={new Set([...Array.from(draftAccountIds), ...Array.from(draftGroupIds)])}
                                    onSelectionChange={(keys) => {
                                        const next = new Set(Array.from(keys).map(String));
                                        // A group tag's key is a group id, so a change that
                                        // turns one on or off is routed through the expander
                                        // rather than being taken as an account id.
                                        const changedGroup = groupOptions.find((g) =>
                                            next.has(g.id) !== draftGroupIds.has(g.id));
                                        if (changedGroup) {
                                            toggleGroupTag(changedGroup.id);
                                            return;
                                        }
                                        setDraftAccountIds(next);
                                    }}
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
                                    {/* HeroUI's collection only accepts a flat list of
                                        items, so the optional section headers are spread
                                        in as arrays rather than conditionals. */}
                                    {[
                                        ...(groupOptions.length > 0 ? [
                                            <SelectItem key="__groups_header" isDisabled textValue="Groups"
                                                className="opacity-100 data-[disabled=true]:opacity-100">
                                                <span className="text-tiny uppercase tracking-wide text-default-400">{locale.GroupTagHeader || "Groups"}</span>
                                            </SelectItem>,
                                        ] : []),
                                        // A tag is a shortcut over the account selection, not a
                                        // separate filter: choosing one selects its members, which
                                        // then show up as accounts and can be trimmed from there.
                                        ...groupOptions.map((g) => (
                                            <SelectItem key={g.id} textValue={g.name}
                                                className="data-[selected=true]:bg-primary-100 dark:data-[selected=true]:bg-primary-900/40">
                                                <span className="flex items-center gap-2">
                                                    <span className={`text-tiny px-1.5 py-0.5 rounded-full
                                                        ${draftGroupIds.has(g.id)
                                                            ? "bg-primary text-primary-foreground"
                                                            : "bg-default-200 text-default-600"}`}>
                                                        tag
                                                    </span>
                                                    <span>{g.name}</span>
                                                    <span className="text-tiny text-default-400">({g.member_count})</span>
                                                </span>
                                            </SelectItem>
                                        )),
                                        ...(groupOptions.length > 0 && accounts.length > 0 ? [
                                            <SelectItem key="__accounts_header" isDisabled textValue="Accounts"
                                                className="opacity-100 data-[disabled=true]:opacity-100">
                                                <span className="text-tiny uppercase tracking-wide text-default-400">{locale.Accounts || "Accounts"}</span>
                                            </SelectItem>,
                                        ] : []),
                                        ...accounts.map((a) => (
                                            <SelectItem key={a.id}>{a.name} ({a.email})</SelectItem>
                                        )),
                                    ]}
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
                            <DateRangePicker
                                from={rangeFrom}
                                to={rangeTo}
                                locale={locale}
                                onChange={(f, t) => { setRangeFrom(f); setRangeTo(t); }}
                            />
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
                        <UsageSessions groups={groups} totals={totals} recentSessions={recentSessions} gapMinutes={gapMinutes} isAdmin={admin} groupBy={groupBy} valueType={valueType} since={rangeToMs(rangeFrom, rangeTo).since} />
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
