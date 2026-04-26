import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

export default function RegenerateModal({
    isOpen,
    onOpenChange,
    onConfirm,
    regenerating,
}: {
    isOpen: boolean;
    onOpenChange: () => void;
    onConfirm: () => void;
    regenerating: boolean;
}) {
    const locale = Locale("ProfilePage");

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
            <ModalContent>
                {(onClose) => (
                    <>
                        <ModalHeader>{locale.Regenerate}</ModalHeader>
                        <ModalBody>
                            <p className="text-sm text-gray-600">{locale.RegenerateConfirm}</p>
                        </ModalBody>
                        <ModalFooter>
                            <Button size="sm" variant="flat" onPress={onClose}>{locale.Cancel}</Button>
                            <Button size="sm" color="danger" onPress={onConfirm} isLoading={regenerating}>
                                {locale.Regenerate}
                            </Button>
                        </ModalFooter>
                    </>
                )}
            </ModalContent>
        </Modal>
    );
}
