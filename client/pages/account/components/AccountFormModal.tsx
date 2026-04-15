import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Checkbox, CheckboxGroup, Input } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type Permission = { name: string; type: string };

const PERMISSION_OPTIONS: Permission[] = [
    { name: "model", type: "menu" },
    { name: "usage", type: "menu" },
    { name: "account", type: "menu" },
    { name: "model", type: "page" },
    { name: "usage", type: "page" },
    { name: "account", type: "page" },
];

const TYPE_LABEL: Record<string, string> = {
    menu: "菜单",
    page: "页面",
    api: "接口",
};

type AccountForm = {
    name: string;
    email: string;
    password: string;
    is_admin: number;
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

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
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