import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Select, SelectItem, Switch } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type ProviderForm = {
    model_alias: string;
    priority: number;
    name: string;
    base_url: string;
    model: string;
    api_key?: string;
    auth_type: string;
    api_type: string;
    proxy_url?: string;
    supports_thinking: number;
    supports_reasoning_effort: number;
    replay_reasoning: number;
    enable_search: number;
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
                            value={form.model_alias}
                            onChange={e => onFormChange({ ...form, model_alias: e.target.value })}
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
                            value={form.base_url}
                            onChange={e => onFormChange({ ...form, base_url: e.target.value })}
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
                            value={form.api_key || ""}
                            onChange={e => onFormChange({ ...form, api_key: e.target.value })}
                        />
                        <Select
                            label={locale.AuthType}
                            selectedKeys={[form.auth_type]}
                            onChange={e => onFormChange({ ...form, auth_type: e.target.value })}
                        >
                            <SelectItem key="bearer">Bearer</SelectItem>
                            <SelectItem key="custom">Custom</SelectItem>
                        </Select>
                        <Select
                            label={locale.ApiType}
                            selectedKeys={[form.api_type]}
                            onChange={e => onFormChange({ ...form, api_type: e.target.value })}
                        >
                            <SelectItem key="openai">OpenAI</SelectItem>
                            <SelectItem key="anthropic">Anthropic</SelectItem>
                            <SelectItem key="gemini">Gemini</SelectItem>
                        </Select>
                        <div className="flex flex-row items-center gap-2">
                            <span className="text-sm">{locale.Search}</span>
                            <Switch
                                isSelected={form.enable_search === 1}
                                onValueChange={v => onFormChange({ ...form, enable_search: v ? 1 : 0 })}
                            />
                        </div>
                        <Input
                            label={locale.ProxyURL}
                            value={form.proxy_url || ""}
                            onChange={e => onFormChange({ ...form, proxy_url: e.target.value })}
                        />
                        <div className="flex flex-row items-center gap-2">
                            <span className="text-sm">{locale.SupportsThinking}</span>
                            <Switch
                                isSelected={form.supports_thinking === 1}
                                onValueChange={v => onFormChange({ ...form, supports_thinking: v ? 1 : 0 })}
                            />
                        </div>
                        <div className="flex flex-row items-center gap-2">
                            <span className="text-sm">{locale.SupportsReasoningEffort}</span>
                            <Switch
                                isSelected={form.supports_reasoning_effort === 1}
                                onValueChange={v => onFormChange({ ...form, supports_reasoning_effort: v ? 1 : 0 })}
                            />
                        </div>
                        <div className="flex flex-row items-center gap-2">
                            <span className="text-sm">{locale.ReplayReasoning}</span>
                            <Switch
                                isSelected={form.replay_reasoning === 1}
                                onValueChange={v => onFormChange({ ...form, replay_reasoning: v ? 1 : 0 })}
                            />
                        </div>
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
