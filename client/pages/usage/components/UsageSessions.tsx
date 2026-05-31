import { useMemo } from "react";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@heroui/react";
import { UsageSessionTotals, UserSessionGroup, UserSession, ProviderUsage } from "../../../../shared/modules/usage/usage.interface";
import { stringToColor, fmtM, fmtK, format24Time, stripEmail } from "./utils";

type Props = {
    groups: UserSessionGroup[];
    totals: UsageSessionTotals;
    recentSessions: UserSession[];
    gapMinutes?: number;
};

function getActiveProviders(
    groups: UserSessionGroup[],
): string[] {
    const totals = new Map<string, number>();
    for (const g of groups) {
        for (const s of g.sessions) {
            for (const pu of s.providerUsage) {
                totals.set(pu.providerName, (totals.get(pu.providerName) || 0) + pu.input_tokens + pu.output_tokens);
            }
        }
    }
    return Array.from(totals.entries())
        .filter(([, v]) => v > 0)
        .map(([k]) => k)
        .sort();
}

function formatChartLabel(ts: number, showDate: boolean): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (!showDate) return `${hh}:${mm}`;
    const M = String(d.getMonth() + 1).padStart(2, "0");
    const DD = String(d.getDate()).padStart(2, "0");
    return `${M}/${DD} ${hh}:${mm}`;
}

function buildChartData(
    sessions: UserSessionGroup["sessions"],
    providers: string[],
    showDate: boolean,
): Record<string, number | string>[] {
    return sessions.map((s) => {
        const row: Record<string, number | string> = {
            timeLabel: formatChartLabel(s.startTime, showDate),
            startTime: s.startTime,
            cost: s.cost,
        };
        const providerMap = new Map<string, number>();
        for (const pu of s.providerUsage) {
            providerMap.set(pu.providerName, (providerMap.get(pu.providerName) || 0) + pu.input_tokens + pu.output_tokens);
        }
        for (const p of providers) {
            row[p] = providerMap.get(p) || 0;
        }
        return row;
    });
}

export function UsageSessions({ groups, totals, recentSessions, gapMinutes }: Props) {
    const showDate = (gapMinutes ?? 60) >= 60;

    const providers = useMemo(() => getActiveProviders(groups), [groups]);

    const chartSessions = useMemo(() => {
        const all = groups.flatMap(g => g.sessions);
        // Merge sessions with same startTime (from different users) to deduplicate x-axis labels
        const merged = new Map<number, UserSession>();
        for (const s of all) {
            const existing = merged.get(s.startTime);
            if (existing) {
                existing.input_tokens += s.input_tokens;
                existing.output_tokens += s.output_tokens;
                existing.cost += s.cost;
                existing.requestCount += s.requestCount;
                // Merge model_aliases (dedup)
                for (const m of s.model_aliases) {
                    if (!existing.model_aliases.includes(m)) existing.model_aliases.push(m);
                }
                // Merge providerUsage by providerName
                const provMap = new Map<string, ProviderUsage>();
                for (const p of existing.providerUsage) provMap.set(p.providerName, { ...p });
                for (const p of s.providerUsage) {
                    const ep = provMap.get(p.providerName);
                    if (ep) {
                        ep.input_tokens += p.input_tokens;
                        ep.output_tokens += p.output_tokens;
                    } else {
                        provMap.set(p.providerName, { ...p });
                    }
                }
                existing.providerUsage = Array.from(provMap.values());
            } else {
                merged.set(s.startTime, { ...s, model_aliases: [...s.model_aliases], providerUsage: s.providerUsage.map(p => ({ ...p })) });
            }
        }
        const result = Array.from(merged.values());
        result.sort((a, b) => a.startTime - b.startTime);
        return result;
    }, [groups]);

    const chartData = useMemo(() => {
        return buildChartData(chartSessions, providers, showDate);
    }, [chartSessions, providers, showDate]);

    if (groups.length === 0) {
        return <div className="text-center text-default-400 py-12">No data</div>;
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Total stats summary */}
            <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-1">
                    <span className="text-default-500">Requests:</span>
                    <span className="font-semibold font-mono">{totals.totalRequests}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-default-500">Total Tokens:</span>
                    <span className="font-semibold font-mono">{fmtM(totals.totalTokens)}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-default-500">Total Cost:</span>
                    <span className="font-semibold font-mono">${totals.totalCost.toFixed(4)}</span>
                </div>
            </div>
            {/* Stacked bar chart */}
            {chartData.length === 0 ? (
                <div className="text-center text-default-400 py-12">No data</div>
            ) : (
                <ResponsiveContainer width="100%" height={400}>
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--heroui-default-200))" />
                        <XAxis
                            dataKey="timeLabel"
                            tick={{ fontSize: 11, fontStyle: "normal" }}
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
                                const cost = payload?.[0]?.payload?.cost != null ? `$${Number(payload[0].payload.cost).toFixed(4)}` : "";
                                return `${String(label)}${cost ? ` | ${cost}` : ""}`;
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

            {/* Recent sessions table */}
            <div className="overflow-auto">
                <Table aria-label="Recent sessions" className="min-w-max">
                    <TableHeader>
                        <TableColumn align="center">Time</TableColumn>
                        <TableColumn align="center" className="hidden md:table-cell">Account</TableColumn>
                        <TableColumn align="center">Model</TableColumn>
                        <TableColumn align="center" className="hidden md:table-cell">Input</TableColumn>
                        <TableColumn align="center" className="hidden md:table-cell">Output</TableColumn>
                        <TableColumn align="center">Cost</TableColumn>
                    </TableHeader>
                    <TableBody emptyContent="No sessions">
                        {recentSessions.map((session, idx) => (
                            <TableRow key={`${session.startTime}-${idx}`}>
                                <TableCell className="whitespace-nowrap font-mono text-sm text-center">
                                    {format24Time(session.startTime)}
                                </TableCell>
                                <TableCell className="max-w-32 truncate text-center hidden md:table-cell">
                                    {stripEmail(session.accountName || "")}
                                </TableCell>
                                <TableCell className="font-semibold text-center max-w-28 truncate">{session.model_aliases.join(", ")}</TableCell>
                                <TableCell className="hidden md:table-cell text-center font-mono">{fmtM(session.input_tokens)}</TableCell>
                                <TableCell className="hidden md:table-cell text-center font-mono">{fmtK(session.output_tokens)}</TableCell>
                                <TableCell className="text-center font-mono">${session.cost?.toFixed(4) || "0"}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}