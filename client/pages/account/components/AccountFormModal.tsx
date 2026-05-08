import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Checkbox, CheckboxGroup, Input, Select, SelectItem } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { useEffect, useState } from "react";
import { AiRouter } from "../../../api/instance";
import { ModelsRequest } from "../../../../shared/modules/ai/ai.interface";

type Permission = { name: string; type: string };

const PERMISSION_OPTIONS: Permission[] = [
    { name: "profile", type: "menu" },
    { name: "subscription", type: "menu" },
    { name: "model", type: "menu" },
    { name: "plan", type: "menu" },
    { name: "usage", type: "menu" },
    { name: "account", type: "menu" },
];

const TYPE_LABEL: Record<string, string> = {
    menu: "菜单",
    page: "页面",
    api: "接口",
    model: "模型",
};

type AccountForm = {
    name: string;
    email: string;
    password: string;
    is_admin: number;
    plan: string;
    plan_expires_at: string;
    permissions: string[]; // "menu:model" format for checkbox values
};

type Props = {
    isOpen: boolean;
    onOpenChange: () => void;
    mode: "create" | "edit";
    form: AccountForm;
    onFormChange: (f: AccountForm) => void;
    onConfirm: () => void;
};

function permToKey(p: Permission): string {
    return `${p.type}:${p.name}`;
}

function keyToPerm(key: string): Permission {
    const [type, name] = key.split(":");
    return { name, type };
}

export function AccountFormModal({ isOpen, onOpenChange, mode, form, onFormChange, onConfirm }: Props) {
    const locale = Locale("AccountPage");
    const common = Locale("Common");
    const [allModels, setAllModels] = useState<string[]>([]);
    const [planOptions, setPlanOptions] = useState<{ id: string; name: string }[]>([]);

    // Fetch all model aliases when modal opens in edit mode
    useEffect(() => {
        if (isOpen && mode === "edit") {
            (async () => {
                try {
                    const res = await AiRouter.models(new ModelsRequest({ auth: "" }));
                    if (res.success && res.data) {
                        setAllModels(res.data.map((m: any) => m.id));
                    }
                } catch { /* ignore */ }
            })();
            // Fetch plans for the plan selector
            (async () => {
                try {
                    const { SubscriptionPlanRouter } = await import("../../../api/instance");
                    const { SubscriptionPlanListRequest } = await import("../../../../shared/modules/subscription_plan/subscription_plan.interface");
                    const res = await SubscriptionPlanRouter.list(new SubscriptionPlanListRequest({}));
                    if (res.success && res.data) {
                        setPlanOptions(res.data.list.map((p: any) => ({ id: p.name, name: p.name.toUpperCase() })));
                    }
                } catch { /* ignore */ }
            })();
        }
    }, [isOpen, mode]);

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
            <ModalContent>
                <ModalHeader>{mode === "create" ? locale.CreateTitle : locale.EditTitle}</ModalHeader>
                <ModalBody>
                    <div className="flex flex-col gap-3">
                        <Input
                            label={locale.Name}
                            value={form.name}
                            onChange={e => onFormChange({ ...form, name: e.target.value })}
                            isRequired
                        />
                        <Input
                            label={locale.Email}
                            value={form.email}
                            onChange={e => onFormChange({ ...form, email: e.target.value })}
                            isRequired
                        />
                        {mode === "create" && (
                            <Input
                                label={locale.Password}
                                type="password"
                                value={form.password}
                                onChange={e => onFormChange({ ...form, password: e.target.value })}
                                isRequired
                            />
                        )}
                        {mode === "edit" && (
                            <Select
                                label="Plan"
                                selectedKeys={form.plan ? [form.plan] : []}
                                onSelectionChange={keys => {
                                    const val = Array.from(keys)[0] as string;
                                    if (val) onFormChange({ ...form, plan: val });
                                }}
                                disallowEmptySelection
                            >
                                {planOptions.map(opt => (
                                    <SelectItem key={opt.id}>{opt.name}</SelectItem>
                                ))}
                            </Select>
                        )}

                        {mode === "edit" && (
                            <Input
                                label="套餐到期时间"
                                type="date"
                                value={form.plan_expires_at}
                                onChange={e => onFormChange({ ...form, plan_expires_at: e.target.value })}
                                description="留空表示不限制"
                            />
                        )}

                        {mode === "edit" && form.is_admin ? (
                            <p className="text-sm text-gray-500">{locale.AdminAllPermissions}</p>
                        ) : (
                            <CheckboxGroup
                                label={locale.Permissions}
                                value={form.permissions}
                                onChange={val => onFormChange({ ...form, permissions: val as string[] })}
                            >
                                <div className="grid grid-cols-3">
                                    {PERMISSION_OPTIONS.map(p => (
                                        <Checkbox key={permToKey(p)} value={permToKey(p)}>
                                            {p.name} ({TYPE_LABEL[p.type] || p.type})
                                        </Checkbox>
                                    ))}
                                </div>
                            </CheckboxGroup>
                        )}

                        {mode === "edit" && !form.is_admin && allModels.length > 0 && (
                            <CheckboxGroup
                                label="可调用模型"
                                value={form.permissions}
                                onChange={val => onFormChange({ ...form, permissions: val as string[] })}
                            >
                                <div className="flex flex-wrap gap-2">
                                    {allModels.map(model => (
                                        <Checkbox key={`model:${model}`} value={`model:${model}`}>
                                            {model}
                                        </Checkbox>
                                    ))}
                                </div>
                            </CheckboxGroup>
                        )}
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

export { permToKey, keyToPerm, PERMISSION_OPTIONS };