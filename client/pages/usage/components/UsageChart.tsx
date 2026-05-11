import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { UsageStatsPeriod } from "../../../../shared/modules/usage/usage.interface";
import { Locale } from "../../../methods/locale";

type Props = {
    today: UsageStatsPeriod;
    last24h: UsageStatsPeriod;
    last7Days: UsageStatsPeriod;
};

function pad(n: number) {
    return String(n).padStart(2, "0");
}

function formatTodayMin(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatWeekDay(ts: number): string {
    const d = new Date(ts);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function UsageChart({ today, last24h, last7Days }: Props) {
    const locale = Locale("UsagePage");

    const todayData = today.amounts.map((d) => ({
        hour: formatTodayMin(d.ts),
        amount: d.amount < 0.01 ? null : d.amount,
    }));

    const last24hData = last24h.amounts.map((d) => ({
        hour: formatTodayMin(d.ts),
        amount: d.amount < 0.01 ? null : d.amount,
    }));

    const weekData = last7Days.amounts.map((d) => ({
        hour: formatWeekDay(d.ts),
        amount: d.amount < 0.01 ? null : d.amount,
    }));

    return (
        <div className="flex flex-col gap-8">
            <div>
                <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium">{locale.Today}</span>
                    <span className="text-sm text-gray-500">{locale.Total}: {today.total.toFixed(2)} M</span>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={todayData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={10} />
                        <YAxis tick={{ fontSize: 11 }} unit=" M" />
                        <Tooltip formatter={(v) => v === null ? "0.00 M" : Number(v).toFixed(2) + " M"} />
                        <Line
                            type="monotone"
                            dataKey="amount"
                            name={locale.Today}
                            stroke="#3b82f6"
                            strokeWidth={2}
                            dot={false}
                            connectNulls={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <div>
                <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium">{locale.Last24h}</span>
                    <span className="text-sm text-gray-500">{locale.Total}: {last24h.total.toFixed(2)} M</span>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={last24hData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={10} />
                        <YAxis tick={{ fontSize: 11 }} unit=" M" />
                        <Tooltip formatter={(v) => v === null ? "0.00 M" : Number(v).toFixed(2) + " M"} />
                        <Line
                            type="monotone"
                            dataKey="amount"
                            name={locale.Last24h}
                            stroke="#f59e0b"
                            strokeWidth={2}
                            dot={false}
                            connectNulls={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <div>
                <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium">{locale.Last7Days}</span>
                    <span className="text-sm text-gray-500">{locale.Total}: {last7Days.total.toFixed(2)} M</span>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={weekData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={120} />
                        <YAxis tick={{ fontSize: 11 }} unit=" M" />
                        <Tooltip formatter={(v) => v === null ? "0.00 M" : Number(v).toFixed(2) + " M"} />
                        <Line
                            type="monotone"
                            dataKey="amount"
                            name={locale.Last7Days}
                            stroke="#10b981"
                            strokeWidth={2}
                            dot={false}
                            connectNulls={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
