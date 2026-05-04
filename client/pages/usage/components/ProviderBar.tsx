import { Chip } from "@heroui/react";
import { stringToColor, fmtM, fmtK } from "./utils";

export interface ProviderUsageItem {
    providerName: string;
    inputTokens: number;
    outputTokens: number;
}

/** Proportional horizontal bar showing each provider's token share */
export function ProviderBar({ session }: { session: { inputTokens: number; outputTokens: number; providerUsage: ProviderUsageItem[] } }) {
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

/** Provider chip with coloured left border, shows token breakdown in m */
export function ProviderChip({ pu }: { pu: ProviderUsageItem }) {
    return (
        <Chip
            size="sm"
            variant="flat"
            style={{ borderLeft: `4px solid ${stringToColor(pu.providerName)}` }}
        >
            <span className="whitespace-nowrap">{pu.providerName} {fmtM(pu.inputTokens)}↑ {fmtK(pu.outputTokens)}↓</span>
        </Chip>
    );
}