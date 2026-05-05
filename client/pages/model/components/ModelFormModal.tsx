import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Select, SelectItem, Input } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type ModelForm = {
    tier: number;
    alias?: string;
};

type Props = {
    isOpen: boolean;
    onOpenChange: () => void;
    mode: "create" | "edit";
    form: ModelForm;
    onFormChange: (f: ModelForm) => void;
    onConfirm: () => void;
};

export function ModelFormModal({ isOpen, onOpenChange, mode, form, onFormChange, onConfirm }: Props) {
    const locale = Locale("ModelPage");
    const common = Locale("Common");

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
            <ModalContent>
                <ModalHeader>{mode === "create" ? locale.CreateTitle : locale.EditTitle}</ModalHeader>
                <ModalBody>
                    <div className="flex flex-col gap-3">
                        <Select
                            label={locale.Tier}
                            selectedKeys={[String(form.tier)]}
                            onChange={e => onFormChange({ ...form, tier: parseInt(e.target.value) })}
                        >
                            {[...Array(10)].map((_, i) => (
                                <SelectItem key={String(i + 1)}>{String(i + 1)}</SelectItem>
                            ))}
                        </Select>
                        <Input
                            label={locale.Alias}
                            value={form.alias || ""}
                            onChange={e => onFormChange({ ...form, alias: e.target.value })}
                            isRequired
                        />
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={onOpenChange}>{common.ButtonCancel}</Button>
                    <Button color="primary" onPress={onConfirm}>{common.ButtonConfirm}</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
