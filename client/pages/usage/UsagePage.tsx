import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import {
    UsageSessionsRequest,
    UserSessionGroup,
} from "../../../shared/modules/usage/usage.interface";
import { UsageRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { Select, SelectItem, Button, ButtonGroup } from "@heroui/react";
import { UsageSessions } from "./components/UsageSessions";

const GAP_OPTIONS = [
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

    const [groups, setGroups] = useState<UserSessionGroup[]>([]);
    const [gapMinutes, setGapMinutes] = useState(15);
    const [timePreset, setTimePreset] = useState<number>(0);

    const [loading, setLoading] = useState(true);

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchSessions = useCallback(async (gap: number, preset: number) => {
        setLoading(true);
        const since = computeSince(preset);
        const req = new UsageSessionsRequest({ auth: getToken(), gapMinutes: gap, since });
        const res = await UsageRouter.sessions(req);
        if (res.success && res.data) {
            setGroups(res.data);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchSessions(gapMinutes, timePreset);
    }, [gapMinutes, timePreset, fetchSessions]);

    return (
        <div className="max-w-screen flex flex-col min-h-screen">
            <Header name={Locale("Menu").Usage} />
            <div className="p-3 sm:p-8 flex flex-col gap-4 flex-1 overflow-auto">
                {loading ? (
                    <div className="text-center text-default-400 py-12">{locale.Loading || "Loading..."}</div>
                ) : (
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-3">
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
                        <UsageSessions groups={groups} />
                    </div>
                )}
            </div>
        </div>
    );
}