import { Card, CardBody, CardHeader, Divider, Chip } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type ModelInfo = {
    id: string;
    tier: number;
};

export default function ModelsCard({ models }: { models: ModelInfo[] }) {
    const locale = Locale("ProfilePage");

    // Group by tier
    const grouped: Record<number, ModelInfo[]> = {};
    for (const m of models) {
        if (!grouped[m.tier]) grouped[m.tier] = [];
        grouped[m.tier].push(m);
    }
    const sortedTiers = Object.keys(grouped).map(Number).sort((a, b) => a - b);

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.AvailableModels}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4 space-y-4">
                {sortedTiers.map(tier => (
                    <div key={tier}>
                        <div className="flex items-center gap-2 mb-2">
                            <Chip size="sm" color="primary" variant="flat">{tier}x</Chip>
                            <span className="text-xs text-gray-400">{locale.TierHint.replace("{tier}", String(tier))}</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {grouped[tier].map(m => (
                                <Chip key={m.id} size="sm" variant="light">{m.id}</Chip>
                            ))}
                        </div>
                    </div>
                ))}
                <div className="pt-2 border-t border-default-100">
                    <p className="text-xs text-gray-400">{locale.BillingHint}</p>
                </div>
            </CardBody>
        </Card>
    );
}
