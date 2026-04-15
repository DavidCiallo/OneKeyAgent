import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Select, SelectItem, Input } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { AccountRole } from "../../../../shared/modules/account/account.entity";

type AccountForm = {
    name: string;
    email: string;
    password: string;
    role: AccountRole;
};

type Props = {
    isOpen: boolean;
    onOpenChange: () => void;
    mode: "create" | "edit";
    form: AccountForm;
    onFormChange: (f: AccountForm) => void;
    onConfirm: () => void;
};

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
                        <Select
                            label={locale.Role}
                            selectedKeys={[form.role]}
                            onChange={e => onFormChange({ ...form, role: e.target.value as AccountRole })}
                        >
                            <SelectItem key="admin">{locale.RoleAdmin}</SelectItem>
                            <SelectItem key="user">{locale.RoleUser}</SelectItem>
                        </Select>
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