import { Chip } from "@heroui/react";
import { stringToColor, fmtM, fmtK } from "./utils";

export interface ProviderUsageItem {
    providerName: string;
    input_tokens: number;
    output_tokens: number;
}

/** Provider chip with coloured left border, shows token breakdown in m */
export function ProviderChip({ pu }: { pu: ProviderUsageItem }) {
    return (
        <Chip
            size="sm"
            variant="flat"
            style={{ borderLeft: `4px solid ${stringToColor(pu.providerName)}` }}
        >
            <span className="whitespace-nowrap">{pu.providerName} {fmtM(pu.input_tokens)}↑ {fmtK(pu.output_tokens)}↓</span>
        </Chip>
    );
}