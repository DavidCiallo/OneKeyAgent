import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Select, SelectItem, Switch } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type ProviderForm = {
    modelAlias: string;
    priority: number;
    name: string;
    baseURL: string;
    model: string;
    apiKey?: string;
    authType: string;
    proxyURL?: string;
    enabled: number;
};

type Props = {
    isOpen: boolean;
    onOpenChange: () => void;
    mode: "create" | "edit";
    form: ProviderForm;
    onFormChange: (f: ProviderForm) => void;
    onConfirm: () => void;
};

export function ProviderFormModal({ isOpen, onOpenChange, mode, form, onFormChange, onConfirm }: Props) {
    const locale = Locale("ProviderPage");
    const common = Locale("Common");

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl">
            <ModalContent>
                <ModalHeader>{mode === "create" ? locale.CreateTitle : locale.EditTitle}</ModalHeader>
                <ModalBody>
                    <div className="flex flex-col gap-3">
                        <Input
                            label={locale.ModelAlias}
                            value={form.modelAlias}
                            onChange={e => onFormChange({ ...form, modelAlias: e.target.value })}
                            isRequired
                        />
                        <Select
                            label={locale.Priority}
                            selectedKeys={[String(form.priority)]}
                            onChange={e => onFormChange({ ...form, priority: parseInt(e.target.value) })}
                        >
                            <SelectItem key="1">1</SelectItem>
                            <SelectItem key="2">2</SelectItem>
                            <SelectItem key="3">3</SelectItem>
                            <SelectItem key="4">4</SelectItem>
                            <SelectItem key="5">5</SelectItem>
                        </Select>
                        <Input
                            label={locale.Name}
                            value={form.name}
                            onChange={e => onFormChange({ ...form, name: e.target.value })}
                            isRequired
                        />
                        <Input
                            label={locale.BaseURL}
                            value={form.baseURL}
                            onChange={e => onFormChange({ ...form, baseURL: e.target.value })}
                            isRequired
                        />
                        <Input
                            label={locale.Model}
                            value={form.model}
                            onChange={e => onFormChange({ ...form, model: e.target.value })}
                            isRequired
                        />
                        <Input
                            label={locale.ApiKey}
                            value={form.apiKey || ""}
                            onChange={e => onFormChange({ ...form, apiKey: e.target.value })}
                        />
                        <Select
                            label={locale.AuthType}
                            selectedKeys={[form.authType]}
                            onChange={e => onFormChange({ ...form, authType: e.target.value })}
                        >
                            <SelectItem key="bearer">Bearer</SelectItem>
                            <SelectItem key="custom">Custom</SelectItem>
                        </Select>
                        <Input
                            label={locale.ProxyURL}
                            value={form.proxyURL || ""}
                            onChange={e => onFormChange({ ...form, proxyURL: e.target.value })}
                        />
                        <div className="flex flex-row items-center gap-2">
                            <span className="text-sm">{locale.Enabled}</span>
                            <Switch
                                isSelected={form.enabled === 1}
                                onValueChange={v => onFormChange({ ...form, enabled: v ? 1 : 0 })}
                            />
                        </div>
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
