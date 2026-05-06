import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Select, SelectItem, Input, Switch } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type ModelForm = {
    tier: number;
    alias?: string;
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
                        <Select
                            label={locale.Tier}
                            selectedKeys={[String(form.tier)]}
                            onChange={e => onFormChange({ ...form, tier: parseInt(e.target.value) })}
                        >
                            {[...Array(100)]
                                .map((_, i) => (i))
                                .filter(i => i < 10 || i % 5 == 4)
                                .map(i => <SelectItem key={String(i + 1)}>{String(i + 1)}</SelectItem>)
                            }
                        </Select>
                        <Input
                            label={locale.Alias}
                            value={form.alias || ""}
                            onChange={e => onFormChange({ ...form, alias: e.target.value })}
                            isRequired
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
