import { Card, CardBody, CardHeader, Divider, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

export default function EndpointCard({
    endpoint,
    onCopy,
}: {
    endpoint: string;
    onCopy: (text: string) => void;
}) {
    const locale = Locale("ProfilePage");

    return (
        <Card>
            <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.EndpointSection}</CardHeader>
            <Divider />
            <CardBody className="px-6 py-4 space-y-4">
                <div>
                    <span className="text-sm text-gray-500 block mb-2">{locale.Endpoint}</span>
                    <div className="flex items-center gap-2">
                        <code className="flex-1 text-sm bg-gray-100 px-4 py-1.5 rounded-lg font-mono break-all select-all">
                            {endpoint}
                        </code>
                        <Button size="sm" variant="flat" onPress={() => onCopy(endpoint)}>
                            {locale.Copy}
                        </Button>
                    </div>
                </div>
                <div className="pt-2">
                    <a href="/terms" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">{locale.TermsLink}</a>
                </div>
            </CardBody>
        </Card>
    );
}
