import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input } from "@heroui/react";
import { useState } from "react";
import { Locale } from "../../../methods/locale";

type Props = {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (proxyUrl: string) => Promise<void>;
};

export function ProviderBatchModal({ isOpen, onOpenChange, onConfirm }: Props) {
    const locale = Locale("ProviderPage");
    const common = Locale("Common");
    const [proxyUrl, setProxyUrl] = useState("");
    const [loading, setLoading] = useState(false);

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await onConfirm(proxyUrl);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
            <ModalContent>
                <ModalHeader>{locale.BatchProxyTitle || "Batch Set Proxy"}</ModalHeader>
                <ModalBody>
                    <Input
                        label={locale.ProxyURL}
                        placeholder="https://proxy.example.com"
                        value={proxyUrl}
                        onChange={e => setProxyUrl(e.target.value)}
                    />
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={() => onOpenChange(false)}>
                        {common.ButtonCancel}
                    </Button>
                    <Button color="primary" onPress={handleConfirm} isLoading={loading}>
                        {common.ButtonConfirm}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
