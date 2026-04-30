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
                            <SelectItem key="1">1</SelectItem>
                            <SelectItem key="2">2</SelectItem>
                            <SelectItem key="3">3</SelectItem>
                            <SelectItem key="4">4</SelectItem>
                            <SelectItem key="5">5</SelectItem>
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
