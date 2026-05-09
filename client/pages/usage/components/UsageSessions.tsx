import { useMemo, useState } from "react";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { Select, SelectItem } from "@heroui/react";
import { UserSessionGroup } from "../../../../shared/modules/usage/usage.interface";
import { stringToColor, fmtM, stripEmail } from "./utils";

type Props = {
    groups: UserSessionGroup[];
};

/** Collect all unique provider names that have non-zero total across chart data */
function getActiveProviders(
    groups: UserSessionGroup[],
    accountFilter: Set<string>,
    modelFilter: Set<string>,
): string[] {
    const totals = new Map<string, number>();
    for (const g of groups) {
        if (!accountFilter.has(g.accountId)) continue;
        for (const s of g.sessions) {
            if (!modelFilter.has(s.modelAlias)) continue;
            for (const pu of s.providerUsage) {
                totals.set(pu.providerName, (totals.get(pu.providerName) || 0) + pu.inputTokens + pu.outputTokens);
            }
        }
    }
    return Array.from(totals.entries())
        .filter(([, v]) => v > 0)
        .map(([k]) => k)
        .sort();
}

/** Build chart data: each entry = one session with provider token values */
function buildChartData(
    sessions: UserSessionGroup["sessions"],
    providers: string[],
): Record<string, number | string>[] {
    return sessions.map((s) => {
        const row: Record<string, number | string> = {
            timeLabel: s.windowLabel,
            modelAlias: s.modelAlias,
            startTime: s.startTime,
        };
        const providerMap = new Map<string, number>();
        for (const pu of s.providerUsage) {
            const prev = providerMap.get(pu.providerName) || 0;
            providerMap.set(pu.providerName, prev + pu.inputTokens + pu.outputTokens);
        }
        for (const p of providers) {
            row[p] = providerMap.get(p) || 0;
        }
        return row;
    });
}

export function UsageSessions({ groups }: Props) {
    const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
    const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());

    // Derive all unique accounts and models
    const allAccounts = useMemo(
        () => groups.map((g) => ({ id: g.accountId, name: stripEmail(g.accountName || g.accountId) })),
        [groups],
    );
    const allModels = useMemo(() => {
        const set = new Set<string>();
        for (const g of groups) {
            for (const s of g.sessions) {
                set.add(s.modelAlias);
            }
        }
        return Array.from(set).sort();
    }, [groups]);

    // Auto-select all when nothing selected
    const activeAccounts = selectedAccounts.size > 0 ? selectedAccounts : new Set(allAccounts.map((a) => a.id));
    const activeModels = selectedModels.size > 0 ? selectedModels : new Set(allModels);

    // Filter groups by selected accounts
    const filteredGroups = useMemo(
        () => groups.filter((g) => activeAccounts.has(g.accountId)),
        [groups, activeAccounts],
    );

    // Get all sessions across filtered groups, sorted by time ASC for the chart
    const allSessions = useMemo(() => {
        const s = filteredGroups.flatMap((g) => g.sessions);
        s.sort((a, b) => a.startTime - b.startTime);
        return s;
    }, [filteredGroups]);

    // Filter by model
    const modelSessions = useMemo(
        () => allSessions.filter((s) => activeModels.has(s.modelAlias)),
        [allSessions, activeModels],
    );

    // Only show providers that have non-zero total in the filtered data
    const providers = useMemo(
        () => getActiveProviders(groups, activeAccounts, activeModels),
        [groups, activeAccounts, activeModels],
    );

    const chartData = useMemo(
        () => buildChartData(modelSessions, providers),
        [modelSessions, providers],
    );

    if (groups.length === 0) {
        return <div className="text-center text-default-400 py-12">No data</div>;
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3">
                <Select
                    size="sm"
                    className="w-48"
                    selectionMode="multiple"
                    placeholder="All accounts"
                    selectedKeys={selectedAccounts}
                    onSelectionChange={(keys) => setSelectedAccounts(new Set(Array.from(keys) as string[]))}
                    aria-label="Filter by account"
                >
                    {allAccounts.map((a) => (
                        <SelectItem key={a.id}>{a.name}</SelectItem>
                    ))}
                </Select>

                <Select
                    size="sm"
                    className="w-48"
                    selectionMode="multiple"
                    placeholder="All models"
                    selectedKeys={selectedModels}
                    onSelectionChange={(keys) => setSelectedModels(new Set(Array.from(keys) as string[]))}
                    aria-label="Filter by model"
                >
                    {allModels.map((m) => (
                        <SelectItem key={m}>{m}</SelectItem>
                    ))}
                </Select>
            </div>

            {/* Stacked bar chart */}
            {chartData.length === 0 ? (
                <div className="text-center text-default-400 py-12">No data for selected filters</div>
            ) : (
                <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--heroui-default-200))" />
                        <XAxis
                            dataKey="timeLabel"
                            tick={{ fontSize: 11 }}
                            interval="preserveStartEnd"
                            angle={-20}
                            textAnchor="end"
                            height={50}
                        />
                        <YAxis tickFormatter={(v: number) => fmtM(v)} tick={{ fontSize: 11 }} />
                        <Tooltip
                            contentStyle={{
                                background: "hsl(var(--heroui-content1))",
                                border: "1px solid hsl(var(--heroui-default-200))",
                                borderRadius: 8,
                                fontSize: 12,
                            }}
                            formatter={(value: any, name: any) => [fmtM(Number(value) || 0), String(name)]}
                            labelFormatter={(label: any, payload: readonly any[]) => {
                                const model = payload?.[0]?.payload?.modelAlias;
                                return `${String(label)}${model ? ` | ${model}` : ""}`;
                            }}
                        />
                        <Legend
                            formatter={(value: string) => (
                                <span style={{ fontSize: 12, color: "hsl(var(--heroui-foreground))" }}>{value}</span>
                            )}
                        />
                        {providers.map((provider) => (
                            <Bar
                                key={provider}
                                dataKey={provider}
                                stackId="a"
                                fill={stringToColor(provider)}
                                isAnimationActive={false}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            )}
        </div>
    );
}