import { useState } from "react";
import { Button, Card, CardBody, CardHeader, Divider } from "@heroui/react";
import { Locale } from "../../../methods/locale";

export default function ApiKeyCard({
    apiKey,
    onRegenerate,
    regenerating,
    onConfirmOpen,
}: {
    apiKey: string;
    onRegenerate: () => void;
    regenerating: boolean;
    onConfirmOpen: () => void;
}) {
    const locale = Locale("ProfilePage");
    const [showApiKey, setShowApiKey] = useState(false);

    const maskedKey = (key: string) => {
        if (!key) return "—";
        if (showApiKey) return key;
        return key.slice(0, 6) + "******" + key.slice(-5);
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.ApiKeySection}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4 space-y-4">
                <div className="flex items-center gap-1 sm:gap-2">
                    <code className="flex-1 text-xs sm:text-sm bg-gray-100 px-3 py-2 rounded-lg font-mono truncate select-all">
                        {maskedKey(apiKey)}
                    </code>
                    <Button size="sm" variant="flat" className="min-w-0 px-4 sm:px-3" onPress={() => setShowApiKey(!showApiKey)}>
                        {showApiKey ? locale.Hide : locale.Show}
                    </Button>
                    <Button size="sm" variant="flat" className="min-w-0 px-4 sm:px-3" onPress={() => handleCopy(apiKey)}>
                        {locale.Copy}
                    </Button>
                </div>
                <Button
                    color="danger"
                    variant="bordered"
                    size="sm"
                    className="font-bold"
                    onPress={onConfirmOpen}
                    isLoading={regenerating}
                >
                    {locale.Regenerate}
                </Button>
            </CardBody>
        </Card>
    );
}
