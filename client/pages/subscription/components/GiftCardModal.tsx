import { useState } from "react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { GiftCardRouter } from "../../../api/instance";

export default function GiftCardModal({
    isOpen,
    onOpenChange,
    onSuccess,
}: {
    isOpen: boolean;
    onOpenChange: () => void;
    onSuccess: () => void;
}) {
    const t = Locale("SubscriptionPage");
    const common = Locale("Common");
    const [code, setCode] = useState("");
    const [activating, setActivating] = useState(false);
    const [error, setError] = useState("");

    const handleActivate = async () => {
        if (!code.trim()) return;
        setActivating(true);
        setError("");
        try {
            const res = await GiftCardRouter.redeem({
                auth: localStorage.getItem("access_token") || "",
                code: code.trim(),
            });
            if (res.success) {
                setCode("");
                setError(`Redeemed successfully! +${res.data?.token_amount || 0} tokens`);
                onSuccess();
                setTimeout(() => onOpenChange(), 2000);
            } else {
                setError(res.message || t.GiftCardActivateFailed);
            }
        } catch (err) {
            setError(t.GiftCardActivateFailed);
            console.error("Gift card activation failed:", err);
        } finally {
            setActivating(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
            <ModalContent>
                <ModalHeader>{t.GiftCardTitle}</ModalHeader>
                <ModalBody className="space-y-2">
                    <Input
                        label={t.GiftCardPlaceholder}
                        value={code}
                        onValueChange={setCode}
                        isDisabled={activating}
                        autoFocus
                    />
                    {error && (
                        <p className="text-xs text-danger px-1">{error}</p>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={() => onOpenChange()} isDisabled={activating}>
                        {common.ButtonCancel || "取消"}
                    </Button>
                    <Button
                        color="warning"
                        variant="solid"
                        onPress={handleActivate}
                        isLoading={activating}
                        isDisabled={!code.trim()}
                        className="text-white"
                    >
                        {t.Activate}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}