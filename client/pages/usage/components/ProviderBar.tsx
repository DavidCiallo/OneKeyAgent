import { Chip } from "@heroui/react";
import { stringToColor, fmtM, fmtK } from "./utils";

export interface ProviderUsageItem {
    providerName: string;
    inputTokens: number;
    outputTokens: number;
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