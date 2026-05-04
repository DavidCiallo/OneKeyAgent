import { Accordion, AccordionItem, Chip } from "@heroui/react";
import { UserSessionGroup } from "../../../../shared/modules/usage/usage.interface";
import { Locale } from "../../../methods/locale";
import { ProviderBar, ProviderChip } from "./ProviderBar";
import { fmtM, fmtK, format24Time, stripEmail } from "./utils";

type Props = {
    groups: UserSessionGroup[];
};

export function UsageSessions({ groups }: Props) {
    const locale = Locale("UsagePage");

    if (groups.length === 0) {
        return <div className="text-center text-default-400 py-12">{locale.NoData}</div>;
    }

    return (
        <Accordion variant="splitted" selectionMode="multiple">
            {groups.map((group) => (
                <AccordionItem
                    key={group.accountId}
                    title={
                        <div className="flex flex-row items-center gap-3">
                            <span className="font-bold truncate">
                                <span className="sm:hidden">{stripEmail(group.accountName || "").replace(/ .*/, "")}</span>
                                <span className="hidden sm:inline">{stripEmail(group.accountName || "")}</span>
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
    );
}