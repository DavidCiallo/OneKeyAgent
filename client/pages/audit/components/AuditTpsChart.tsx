import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AuditMetric, AuditTpsResult } from "../../../../shared/modules/audit/audit.interface";
import { auditApi } from "../../../api/instance";
import { Locale } from "../../../methods/locale";

/** How much history to draw. Matches the ranges the endpoint knows about. */
type Range = "1h" | "12h" | "48h";

const RANGES: Range[] = ["1h", "12h", "48h"];

/** Line colors, assigned by provider order. Enough for any realistic chain; a
 *  longer one repeats rather than rendering nothing. */
const COLORS = ["#006FEE", "#17C964", "#F5A524", "#F31260", "#7828C8", "#09b6a2", "#9353D3", "#d4621e"];

function pad(n: number) {
    return String(n).padStart(2, "0");
}

/** Axis label: minutes within the hour for a short window, day + hour when the
 *  window spans days, so a tick never reads ambiguously. */
function tick(ts: number, range: Range): string {
    const d = new Date(ts);
    if (range === "1h") return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (range === "12h") return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`;
}

function formatValue(v: number, metric: AuditMetric): string {
    if (metric === "tps") return `${v.toFixed(1)} t/s`;
    return `${Math.round(v)} ms`;
}

export function AuditTpsChart() {
    const locale = Locale("AuditPage");
    const [range, setRange] = useState<Range>("1h");
    const [metric, setMetric] = useState<AuditMetric>("tps");
    const [result, setResult] = useState<AuditTpsResult | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchSeries = useCallback(async (r: Range) => {
        setLoading(true);
        const res = await auditApi.tps({ range: r });
        if (res.success && res.data) {
            setResult(res.data as AuditTpsResult);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchSeries(range);
    }, [range, fetchSeries]);

    // recharts wants one row per x value with a key per line, so the per-point
    // provider maps are flattened by provider name.
    const data = useMemo(() => {
        if (!result) return [];
        return result.points.map((p) => {
            const row: Record<string, number | string> = { tick: tick(p.ts, range) };
            const values = metric === "tps" ? p.tps : p.ttft;
            for (const provider of result.providers) {
                const v = values[provider.id];
                if (typeof v === "number") row[provider.name || provider.id] = v;
            }
            return row;
        });
    }, [result, metric, range]);

    const providers = result?.providers ?? [];
    const anyData = data.some((row) => providers.some((p) => typeof row[p.name || p.id] === "number"));

    return (
        <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
            <div className="flex flex-row items-center justify-between flex-wrap gap-2">
                <div className="flex flex-row items-center gap-2">
                    <span className="font-medium text-sm">{locale.Throughput || "Throughput"}</span>
                    <span className="text-xs text-gray-400">
                        {metric === "tps"
                            ? (locale.TpsHint || "output tokens per second of generation, first-token wait excluded, thinking included")
                            : (locale.TtftHint || "average wait for the first token, thinking included, streaming requests only")}
                    </span>
                </div>
                <div className="flex flex-row items-center gap-2">
                    {/* Metric first: it decides what the range means to the reader. */}
                    {(["tps", "ttft"] as AuditMetric[]).map((m) => (
                        <Button
                            key={m}
                            size="sm"
                            variant={metric === m ? "solid" : "flat"}
                            onPress={() => setMetric(m)}
                        >
                            {m === "tps" ? "TPS" : "TTFT"}
                        </Button>
                    ))}
                    <span className="w-px h-5 bg-gray-200 mx-1" />
                    {RANGES.map((r) => (
                        <Button
                            key={r}
                            size="sm"
                            variant={range === r ? "solid" : "flat"}
                            onPress={() => setRange(r)}
                        >
                            {r}
                        </Button>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">Loading...</div>
            ) : !anyData ? (
                <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
                    {locale.NoData || "No data"}
                </div>
            ) : (
                <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="tick" tick={{ fontSize: 11 }} minTickGap={24} />
                        <YAxis tick={{ fontSize: 11 }} width={48} />
                        <Tooltip
                            formatter={(value, name) =>
                                [formatValue(Number(value), metric), String(name)] as [string, string]}
                        />
                        {providers.map((p, i) => (
                            <Line
                                key={p.id}
                                type="monotone"
                                // Name, not id: the legend and tooltip read the
                                // provider the way the rest of the page does.
                                dataKey={p.name || p.id}
                                stroke={COLORS[i % COLORS.length]}
                                dot={false}
                                strokeWidth={2}
                                // A bucket with no traffic must break the line
                                // rather than drop to zero.
                                connectNulls={false}
                                isAnimationActive={false}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            )}

            {anyData && (
                <div className="flex flex-row flex-wrap gap-3">
                    {providers.map((p, i) => (
                        <span key={p.id} className="flex items-center gap-1 text-xs text-gray-500">
                            <span
                                className="inline-block w-3 h-[3px] rounded"
                                style={{ backgroundColor: COLORS[i % COLORS.length] }}
                            />
                            {p.name || p.id}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
