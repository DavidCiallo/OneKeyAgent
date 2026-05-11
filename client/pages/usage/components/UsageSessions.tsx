import { useMemo } from "react";
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@heroui/react";
import { UserSessionGroup } from "../../../../shared/modules/usage/usage.interface";
import { stringToColor, fmtM, format24Time, stripEmail } from "./utils";

type Props = {
    groups: UserSessionGroup[];
};

function getActiveProviders(
    groups: UserSessionGroup[],
): string[] {
    const totals = new Map<string, number>();
    for (const g of groups) {
        for (const s of g.sessions) {
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
    // Flatten all sessions, sort by time DESC, take latest 10
    const recentSessions = useMemo(() => {
        const all = groups.flatMap(g => g.sessions);
        all.sort((a, b) => b.startTime - a.startTime);
        return all.slice(0, 10);
    }, [groups]);

    const providers = useMemo(() => getActiveProviders(groups), [groups]);

    const chartData = useMemo(() => {
        const asc = [...recentSessions].sort((a, b) => a.startTime - b.startTime);
        return buildChartData(asc, providers);
    }, [recentSessions, providers]);

    if (groups.length === 0) {
        return <div className="text-center text-default-400 py-12">No data</div>;
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Stacked bar chart */}
            {chartData.length === 0 ? (
                <div className="text-center text-default-400 py-12">No data</div>
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

            {/* Recent sessions table */}
            <div className="overflow-auto">
                <Table aria-label="Recent sessions" className="min-w-max">
                    <TableHeader>
                        <TableColumn>Time</TableColumn>
                        <TableColumn>Account</TableColumn>
                        <TableColumn>Model</TableColumn>
                        <TableColumn align="center">Input</TableColumn>
                        <TableColumn align="center">Output</TableColumn>
                        <TableColumn align="center">Cost</TableColumn>
                    </TableHeader>
                    <TableBody emptyContent="No sessions">
                        {recentSessions.map((session, idx) => (
                            <TableRow key={`${session.startTime}-${idx}`}>
                                <TableCell className="whitespace-nowrap font-mono text-sm">
                                    {format24Time(session.startTime)}
                                </TableCell>
                                <TableCell className="max-w-32 truncate">
                                    {stripEmail(
                                        groups.find(g => g.sessions.includes(session))?.accountName || ""
                                    )}
                                </TableCell>
                                <TableCell className="font-semibold">{session.modelAlias}</TableCell>
                                <TableCell className="text-right">{fmtM(session.inputTokens)}</TableCell>
                                <TableCell className="text-right">{fmtM(session.outputTokens)}</TableCell>
                                <TableCell className="text-right font-mono">${session.cost?.toFixed(4) || "0"}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}