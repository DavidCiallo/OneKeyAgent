import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

export default function PaymentModal({
    isOpen,
    onOpenChange,
    invoiceUrl,
    planName,
    planPrice,
    onCheck,
    checking,
}: {
    isOpen: boolean;
    onOpenChange: () => void;
    invoiceUrl: string | null;
    planName: string;
    planPrice: number;
    onCheck: () => void;
    checking: boolean;
}) {
    const locale = Locale("SubscriptionPage");

    const formatPrice = (cents: number) => "$" + (cents / 100).toFixed(cents % 100 ? 2 : 0);

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
            <ModalContent>
                <ModalHeader>{locale.Payment} - {planName.toUpperCase()}</ModalHeader>
                <ModalBody className="space-y-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-sm text-gray-600">
                            <span className="text-base">{locale.DepositAmount}: </span>
                            <span className="font-bold text-primary text-base">{formatPrice(planPrice)} USD</span>
                        </p>
                    </div>

                    {invoiceUrl && (
                        <Button
                            color="primary"
                            size="md"
                            className="w-full"
                            onPress={() => window.open(invoiceUrl, "_blank")}
                        >
                            前往支付
                        </Button>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={() => onOpenChange()}>
                        {Locale("Common").ButtonCancel || "取消"}
                    </Button>
                    <Button
                        color="primary"
                        onPress={onCheck}
                        isLoading={checking}
                    >
                        {locale.CheckPayment}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}