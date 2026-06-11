import { useMemo } from "react";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@heroui/react";
import { UsageSessionTotals, UserSessionGroup, UserSession, ProviderUsage, ModelUsage } from "../../../../shared/modules/usage/usage.interface";
import { stringToColor, fmtM, fmtK, format24Time, stripEmail } from "./utils";

type Props = {
    groups: UserSessionGroup[];
    totals: UsageSessionTotals;
    recentSessions: UserSession[];
    gapMinutes?: number;
    isAdmin?: boolean;
    groupBy: "provider" | "model";
    valueType: "tokens" | "cost";
};

function getActiveKeys(
    groups: UserSessionGroup[],
    groupBy: "provider" | "model",
    valueType: "tokens" | "cost",
): string[] {
    const totals = new Map<string, number>();
    for (const g of groups) {
        for (const s of g.sessions) {
            const items = groupBy === "provider" ? s.providerUsage : s.modelUsage;
            for (const item of items) {
                const key = groupBy === "provider"
                    ? (item as ProviderUsage).providerName
                    : (item as ModelUsage).model_alias;
                const val = valueType === "cost" ? item.cost : (item.input_tokens + item.output_tokens);
                totals.set(key, (totals.get(key) || 0) + val);
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
    keys: string[],
    showDate: boolean,
    groupBy: "provider" | "model",
    valueType: "tokens" | "cost",
    gapMs: number,
): Record<string, number | string>[] {
    // Index sessions by startTime for fast lookup
    const sessionMap = new Map<number, UserSessionGroup["sessions"][number]>();
    for (const s of sessions) sessionMap.set(s.startTime, s);

    if (sessions.length === 0) return [];

    // Generate full time slots from min to max startTime
    const minTime = sessions[0].startTime;
    const maxTime = sessions[sessions.length - 1].startTime;
    const rows: Record<string, number | string>[] = [];

    for (let t = minTime; t <= maxTime; t += gapMs) {
        const s = sessionMap.get(t);
        const row: Record<string, number | string> = {
            timeLabel: formatChartLabel(t, showDate),
            startTime: t,
            cost: s?.cost ?? 0,
        };

        if (s) {
            const items = groupBy === "provider" ? s.providerUsage : s.modelUsage;
            const keyField = groupBy === "provider" ? "providerName" : "model_alias";
            const map = new Map<string, number>();
            for (const item of items) {
                const key = (item as any)[keyField];
                const val = valueType === "cost" ? item.cost : (item.input_tokens + item.output_tokens);
                map.set(key, (map.get(key) || 0) + val);
            }
            for (const k of keys) {
                row[k] = map.get(k) || 0;
            }
        } else {
            for (const k of keys) row[k] = 0;
        }

        rows.push(row);
    }

    return rows;
}

export function UsageSessions({ groups, totals, recentSessions, gapMinutes, isAdmin, groupBy, valueType }: Props) {
    const showDate = (gapMinutes ?? 60) >= 60;

    const activeKeys = useMemo(() => getActiveKeys(groups, groupBy, valueType), [groups, groupBy, valueType]);

    const chartSessions = useMemo(() => {
        const all = groups.flatMap(g => g.sessions);
        // Merge sessions with same startTime (from different users) to deduplicate x-axis labels
        const merged = new Map<number, UserSession>();
        for (const s of all) {
            const existing = merged.get(s.startTime);
            if (existing) {
                existing.input_tokens += s.input_tokens;
                existing.cached_input_tokens += s.cached_input_tokens || 0;
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
                        ep.cost += p.cost || 0;
                    } else {
                        provMap.set(p.providerName, { ...p });
                    }
                }
                existing.providerUsage = Array.from(provMap.values());
                // Merge modelUsage by model_alias
                const modelMap = new Map<string, ModelUsage>();
                for (const m of existing.modelUsage) modelMap.set(m.model_alias, { ...m });
                for (const m of s.modelUsage) {
                    const em = modelMap.get(m.model_alias);
                    if (em) {
                        em.input_tokens += m.input_tokens;
                        em.output_tokens += m.output_tokens;
                        em.cost += m.cost || 0;
                    } else {
                        modelMap.set(m.model_alias, { ...m });
                    }
                }
                existing.modelUsage = Array.from(modelMap.values());
            } else {
                merged.set(s.startTime, {
                    ...s,
                    model_aliases: [...s.model_aliases],
                    providerUsage: s.providerUsage.map(p => ({ ...p })),
                    modelUsage: s.modelUsage.map(m => ({ ...m })),
                });
            }
        }
        const result = Array.from(merged.values());
        result.sort((a, b) => a.startTime - b.startTime);
        return result;
    }, [groups]);

    const gapMs = (gapMinutes ?? 60) * 60 * 1000;

    const chartData = useMemo(() => {
        return buildChartData(chartSessions, activeKeys, showDate, groupBy, valueType, gapMs);
    }, [chartSessions, activeKeys, showDate, groupBy, valueType, gapMs]);

    if (groups.length === 0) {
        return <div className="text-center text-default-400 py-12">No data</div>;
    }

    const isCost = valueType === "cost";
    const formatValue = (v: number) => isCost ? `$${v.toFixed(2)}` : fmtM(v);
    const formatValueFull = (v: number) => isCost ? `$${Number(v).toFixed(4)}` : fmtM(Number(v) || 0);

    return (
        <div className="flex flex-col gap-4">
            {/* Total stats summary */}
            <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-1">
                    <span className="text-default-500">Requests:</span>
                    <span className="font-semibold font-mono">{totals.totalRequests}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-default-500">Input:</span>
                    <span className="font-semibold font-mono">{fmtM(totals.totalInputTokens)}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-default-500">Cached:</span>
                    <span className="font-semibold font-mono">{fmtM(totals.totalCachedInputTokens)}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-default-500">Output:</span>
                    <span className="font-semibold font-mono">{fmtM(totals.totalOutputTokens)}</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-default-500">Cost:</span>
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
                        <YAxis
                            tickFormatter={formatValue}
                            tick={{ fontSize: 11 }}
                        />
                        <Tooltip
                            contentStyle={{
                                background: "hsl(var(--heroui-content1))",
                                border: "1px solid hsl(var(--heroui-default-200))",
                                borderRadius: 8,
                                fontSize: 12,
                            }}
                            formatter={(value: any, name: any) =>
                                [formatValueFull(Number(value)), String(name)]
                            }
                            labelFormatter={(label: any, payload: readonly any[]) => {
                                const cost = payload?.[0]?.payload?.cost != null ? `$${Number(payload[0].payload.cost).toFixed(4)}` : "";
                                return `${String(label)}${cost ? ` | ${cost}` : ""}`;
                            }}
                        />
                        <Legend
                            formatter={(value: string) => (
                                <span style={{ fontSize: 12, color: "hsl(var(--heroui-foreground))" }}>{value}</span>
                            )}
                            wrapperStyle={{ paddingTop: 8 }}
                        />
                        {activeKeys.map((key) => (
                            <Bar
                                key={key}
                                dataKey={key}
                                stackId="a"
                                fill={stringToColor(key)}
                                isAnimationActive={false}
                            />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            )}

            {/* Recent sessions table */}
            <div className="overflow-auto">
                {isAdmin ? (
                    <Table aria-label="Recent sessions" className="min-w-max">
                        <TableHeader>
                            <TableColumn align="center">Time</TableColumn>
                            <TableColumn align="center" className="hidden md:table-cell">Account</TableColumn>
                            <TableColumn align="center">Model</TableColumn>
                            <TableColumn align="center" className="hidden md:table-cell">Input</TableColumn>
                            <TableColumn align="center" className="hidden md:table-cell">Cached</TableColumn>
                            <TableColumn align="center" className="hidden md:table-cell">Output</TableColumn>
                            <TableColumn align="center">Cost</TableColumn>
                        </TableHeader>
                        <TableBody emptyContent="No sessions">
                            {recentSessions.map((session, idx) => (
                                <TableRow key={`${session.startTime}-${idx}`}>
                                    <TableCell className="whitespace-nowrap font-mono text-sm text-center">{format24Time(session.startTime)}</TableCell>
                                    <TableCell className="max-w-32 truncate text-center hidden md:table-cell">{stripEmail(session.accountName || "")}</TableCell>
                                    <TableCell className="font-semibold text-center max-w-28 truncate">{session.model_aliases.join(", ")}</TableCell>
                                    <TableCell className="hidden md:table-cell text-center font-mono">{fmtM(session.input_tokens)}</TableCell>
                                    <TableCell className="hidden md:table-cell text-center font-mono">{fmtM(session.cached_input_tokens || 0)}</TableCell>
                                    <TableCell className="hidden md:table-cell text-center font-mono">{fmtK(session.output_tokens)}</TableCell>
                                    <TableCell className="text-center font-mono">${session.cost?.toFixed(4) || "0"}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                ) : (
                    <Table aria-label="Recent sessions" className="min-w-max">
                        <TableHeader>
                            <TableColumn align="center">Time</TableColumn>
                            <TableColumn align="center" className="min-w-[10rem] md:min-w-[24rem]">Model</TableColumn>
                            <TableColumn align="center" className="hidden md:table-cell">Input</TableColumn>
                            <TableColumn align="center" className="hidden md:table-cell">Cached</TableColumn>
                            <TableColumn align="center" className="hidden md:table-cell">Output</TableColumn>
                            <TableColumn align="center">Cost</TableColumn>
                        </TableHeader>
                        <TableBody emptyContent="No sessions">
                            {recentSessions.map((session, idx) => (
                                <TableRow key={`${session.startTime}-${idx}`}>
                                    <TableCell className="whitespace-nowrap font-mono text-sm text-center">{format24Time(session.startTime)}</TableCell>
                                    <TableCell className="font-semibold text-center min-w-[10rem] md:min-w-[24rem] truncate">{session.model_aliases.join(", ")}</TableCell>
                                    <TableCell className="hidden md:table-cell text-center font-mono">{fmtM(session.input_tokens)}</TableCell>
                                    <TableCell className="hidden md:table-cell text-center font-mono">{fmtM(session.cached_input_tokens || 0)}</TableCell>
                                    <TableCell className="hidden md:table-cell text-center font-mono">{fmtK(session.output_tokens)}</TableCell>
                                    <TableCell className="text-center font-mono">${session.cost?.toFixed(4) || "0"}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>
        </div>
    );
}
