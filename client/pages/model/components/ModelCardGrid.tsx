import { Button, Chip } from "@heroui/react";
import { ModelDTO } from "../../../../shared/modules/model/model.entity";
import { Locale } from "../../../methods/locale";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { UsageAmountData, UsageStatsPeriod } from "../../../../shared/modules/usage/usage.interface";

type ModelWithUsage = ModelDTO & {
    todayPeriod?: UsageStatsPeriod;
    last24hPeriod?: UsageStatsPeriod;
    weekPeriod?: UsageStatsPeriod;
};

type Props = {
    list: ModelWithUsage[];
    onEdit: (item: ModelDTO) => void;
    onDelete: (id: string) => void;
};

function pad(n: number) {
    return String(n).padStart(2, "0");
}

function formatHourMin(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatWeekDay(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function MiniChart({ data, color, label, total, timeKey }: { data: UsageAmountData[]; color: string; total: number; label: string; timeKey: "hour" | "day" }) {
    const formatter = timeKey === "hour" ? formatHourMin : formatWeekDay;
    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between text-xs">
                <span className="text-default-500 font-medium">{label}</span>
                <span className="text-default-400 tabular-nums">{total.toFixed(2)}M</span>
            </div>
            <div className="h-16">
                {data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                            <YAxis domain={["dataMin", "dataMax"]} hide />
                            <Line
                                type="monotone"
                                dataKey="amount"
                                stroke={color}
                                strokeWidth={1.5}
                                dot={false}
                                isAnimationActive={false}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full flex items-center justify-center text-default-300 text-[10px]">—</div>
                )}
            </div>
            {/* Time labels: pick 4 evenly spaced points */}
            {data.length > 0 && (
                <div className="flex justify-between text-[10px] text-default-300 px-0.5">
                    {[0, 1, 2, 3].map(i => {
                        const idx = Math.min(Math.floor((i / 3) * (data.length - 1)), data.length - 1);
                        return <span key={i}>{formatter(data[idx].ts)}</span>;
                    })}
                </div>
            )}
        </div>
    );
}

export function ModelCardGrid({ list, onEdit, onDelete }: Props) {
    const locale = Locale("ModelPage");

    if (list.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                {locale.NoData}
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto px-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {list.map(item => (
                    <div
                        key={item.id}
                        className="bg-content1 rounded-xl shadow-sm border border-default-100 p-4 flex flex-col gap-2.5 hover:shadow-md transition-shadow"
                    >
                        {/* Header: Alias + Public */}
                        <div className="flex items-center gap-2 pb-2.5 border-b border-default-200">
                            <span className="text-xl font-bold text-foreground truncate">
                                {item.alias || "—"}
                            </span>
                            {item.is_public === 1 && (
                                <Chip color="success" variant="flat" size="sm">{locale.Public}</Chip>
                            )}
                        </div>

                        {/* Prices */}
                        <div className="flex gap-3 text-xs text-default-500">
                            <span>IN: <strong className="text-foreground font-mono">${item.input_price.toFixed(3)}</strong> /M</span>
                            <span>OUT: <strong className="text-foreground font-mono">${item.output_price.toFixed(3)}</strong> /M</span>
                        </div>

                        {/* Three mini charts */}
                        <MiniChart
                            data={item.todayPeriod?.amounts || []}
                            color="#3b82f6"
                            label={locale.Today}
                            total={item.todayPeriod?.total ?? 0}
                            timeKey="hour"
                        />
                        <MiniChart
                            data={item.last24hPeriod?.amounts || []}
                            color="#f59e0b"
                            label={locale.Last24h}
                            total={item.last24hPeriod?.total ?? 0}
                            timeKey="hour"
                        />
                        <MiniChart
                            data={item.weekPeriod?.amounts || []}
                            color="#10b981"
                            label={locale.Last7Days}
                            total={item.weekPeriod?.total ?? 0}
                            timeKey="day"
                        />

                        {/* Actions */}
                        <div className="flex flex-row gap-2 pt-1">
                            <Button
                                size="sm"
                                variant="flat"
                                className="flex-1 min-w-0"
                                onPress={() => onEdit(item)}
                            >
                                {locale.Edit}
                            </Button>
                            <Button
                                size="sm"
                                variant="flat"
                                color="danger"
                                className="flex-1 min-w-0"
                                onPress={() => onDelete(item.id)}
                            >
                                {locale.Delete}
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
