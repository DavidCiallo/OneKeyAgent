import { Card, CardBody, CardHeader, Divider } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { money } from "../../../methods/money";

export default function CurrentPlanCard({ tokens }: { tokens: number }) {
    const locale = Locale("TopupPage");

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.CurrentPlan}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4">
                <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500 w-24">{locale.Balance}</span>
                    <span className="text-lg font-bold text-primary">{money(tokens)}</span>
                </div>
            </CardBody>
        </Card>
    );
}