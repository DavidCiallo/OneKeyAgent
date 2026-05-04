import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import {
    UserSessionGroup,
    UserSession,
    UsageSessionsRequest,
} from "../../../shared/modules/usage/usage.interface";
import { UsageRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import {
    Accordion,
    AccordionItem,
    Chip,
} from "@heroui/react";

/** Format tokens in millions, 3 decimal places. e.g. 1234567 → "1.235m" */
function fmtM(v: number): string {
    return (v / 1000000).toFixed(2) + "m";
}

function fmtK(v: number): string {
    return (v / 1000).toFixed(2) + "k";
}

/** Render a proportional horizontal bar showing each provider's token share */
function ProviderBar({ session }: { session: UserSession }) {
    const total = session.inputTokens + session.outputTokens;
    if (total === 0) return null;

    return (
        <div className="flex items-center gap-1 mt-2">
            {session.providerUsage.map((pu) => {
                const pct = ((pu.inputTokens + pu.outputTokens) / total) * 100;
                return (
                    <div
                        key={pu.providerName}
                        className="h-3 rounded-full first:rounded-l-full last:rounded-r-full min-w-[4px]"
                        style={{
                            width: `${Math.max(pct, 0.5)}%`,
                            backgroundColor: stringToColor(pu.providerName),
                        }}
                        title={`${pu.providerName}: ${fmtM(pu.inputTokens + pu.outputTokens)} (${pct.toFixed(0)}%)`}
                    />
                );
            })}
        </div>
    );
}

/** Derive a stable hue from a provider name string */
function stringToColor(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 55%, 45%)`;
}

function format24Time(ts: number): string {
    const d = new Date(ts);
    const MM = String(d.getMonth() + 1).padStart(2, "0");
    const DD = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${MM}/${DD} ${hh}:${mm}`;
}

/** Provider chip with coloured left border, shows token breakdown in m */
function ProviderChip({ pu }: { pu: { providerName: string; inputTokens: number; outputTokens: number } }) {
    return (
        <Chip
            size="sm"
            variant="flat"
            style={{ borderLeft: `3px solid ${stringToColor(pu.providerName)}` }}
        >
            <span className="whitespace-nowrap">{pu.providerName} {fmtM(pu.inputTokens)}↑ {fmtM(pu.outputTokens)}↓</span>
        </Chip>
    );
}

export default function UsagePage() {
    const locale = Locale("UsagePage");

    const [groups, setGroups] = useState<UserSessionGroup[]>([]);
    const [loading, setLoading] = useState(true);

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchSessions = useCallback(async () => {
        setLoading(true);
        const req = new UsageSessionsRequest({ auth: getToken() });
        const res = await UsageRouter.sessions(req);
        if (res.success && res.data) {
            setGroups(res.data);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

    return (
        <div className="max-w-screen flex flex-col min-h-screen">
            <Header name={Locale("Menu").Usage} />
            <div className="p-3 sm:p-8 flex flex-col gap-4 flex-1 overflow-auto">
                {loading ? (
                    <div className="text-center text-default-400 py-12">{locale.Loading || "Loading..."}</div>
                ) : groups.length === 0 ? (
                    <div className="text-center text-default-400 py-12">{locale.NoData}</div>
                ) : (
                    <Accordion variant="splitted" selectionMode="multiple">
                        {groups.map((group) => (
                            <AccordionItem
                                key={group.accountId}
                                title={
                                    <div className="flex flex-row items-center gap-3">
                                        <span className="font-bold truncate">
                                            <span className="sm:hidden">{group.accountName.replace(/ .*/, "")}</span>
                                            <span className="hidden sm:inline">{group.accountName}</span>
                                        </span>
                                        <Chip size="sm" variant="flat" className="shrink-0 text-xs">
                                            {fmtM(group.totalTokens)}
                                        </Chip>
                                    </div>
                                }
                                className="mb-2"
                            >
                                <Accordion variant="splitted" selectionMode="multiple" className="mb-4">
                                    {group.sessions.map((session, idx) => (
                                        <AccordionItem
                                            key={`${session.startTime}-${idx}`}
                                            title={
                                                <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
                                                    <span className="whitespace-nowrap font-mono md:text-base text-sm">
                                                        {format24Time(session.startTime)} — {format24Time(session.endTime)}
                                                    </span>
                                                    <span className="font-semibold md:text-lg text-base truncate">
                                                        {session.modelAlias}
                                                    </span>
                                                    <span className="text-default-500 text-xs sm:ml-auto whitespace-nowrap">
                                                        {fmtM(session.inputTokens)}↑ {fmtK(session.outputTokens)}↓
                                                    </span>
                                                </div>
                                            }
                                            textValue={`${format24Time(session.startTime)} ${session.modelAlias}`}
                                        >
                                            <ProviderBar session={session} />
                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {session.providerUsage.map((pu) => (
                                                    <ProviderChip key={pu.providerName} pu={pu} />
                                                ))}
                                            </div>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </AccordionItem>
                        ))}
                    </Accordion>
                )}
            </div>
        </div>
    );
}
