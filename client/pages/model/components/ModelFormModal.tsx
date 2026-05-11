import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Switch } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type ModelForm = {
    alias?: string;
    input_price: number;
    output_price: number;
    is_public?: number;
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
                        <Input
                            label={locale.Alias}
                            value={form.alias || ""}
                            onChange={e => onFormChange({ ...form, alias: e.target.value })}
                            isRequired
                        />
                        <Input
                            label={locale.InputPrice || "Input Price"}
                            value={String(form.input_price)}
                            onChange={e => onFormChange({ ...form, input_price: Number(e.target.value) || 0 })}
                        />
                        <Input
                            label={locale.OutputPrice || "Output Price"}
                            value={String(form.output_price)}
                            onChange={e => onFormChange({ ...form, output_price: Number(e.target.value) || 0 })}
                        />
                        <Switch
                            isSelected={form.is_public === 1}
                            onValueChange={v => onFormChange({ ...form, is_public: v ? 1 : 0 })}
                        >
                            {locale.Public}
                        </Switch>
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
