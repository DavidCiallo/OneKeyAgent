import { Card, CardBody, CardHeader, Divider, Button, useDisclosure } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import GiftCardModal from "./GiftCardModal";

interface PrepaidTopupProps {
    onGiftCardActivated?: () => void;
    children?: React.ReactNode;
}

export default function PrepaidTopup({ onGiftCardActivated, children }: PrepaidTopupProps) {
    const t = Locale("TopupPage");
    const giftCardModal = useDisclosure();

    const handleGiftCardActivated = () => {
        onGiftCardActivated?.();
    };

    return (
        <>
            <Card>
                <CardHeader className="px-6 py-4 font-semibold text-lg">{t.PrepaidTopup}</CardHeader>
                <Divider />
                <CardBody className="px-6 py-4 space-y-4">
                    {/* Recharge / Top-Up section */}
                    {children && (
                        <div>
                            {children}
                        </div>
                    )}

                    {/* Gift Card — compact row */}
                    <div className="flex items-center justify-between rounded-lg bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
                        <div>
                            <p className="text-sm font-medium">{t.GiftCard}</p>
                            <p className="text-xs text-gray-500">{t.GiftCardDesc}</p>
                        </div>
                        <Button
                            color="warning"
                            variant="flat"
                            size="sm"
                            onPress={giftCardModal.onOpen}
                        >
                            {t.Activate}
                        </Button>
                    </div>
                </CardBody>
            </Card>

            <GiftCardModal
                isOpen={giftCardModal.isOpen}
                onOpenChange={giftCardModal.onOpenChange}
                onSuccess={handleGiftCardActivated}
            />
        </>
    );
}