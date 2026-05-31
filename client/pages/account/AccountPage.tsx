import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { AccountDTO } from "../../../shared/modules/account/account.interface";
import { accountApi, roleApi } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { useDisclosure } from "@heroui/react";
import { AccountFilter } from "./components/AccountFilter";
import { AccountTable } from "./components/AccountTable";
import { AccountPagination } from "./components/AccountPagination";
import { AccountFormModal, permToKey } from "./components/AccountFormModal";

type AccountForm = {
    name: string;
    email: string;
    password: string;
    is_admin: number;
    permissions: string[]; // "menu:model" format
};

export default function AccountPage() {
    const [list, setList] = useState<AccountDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    // Filter
    const [filterName, setFilterName] = useState("");
    const [filterEmail, setFilterEmail] = useState("");

    // Form modal
    const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose, onOpenChange: onFormOpenChange } = useDisclosure();
    const [formMode, setFormMode] = useState<"create" | "edit">("create");
    const [editId, setEditId] = useState<string>("");
    const [form, setForm] = useState<AccountForm>({ name: "", email: "", password: "", is_admin: 0, permissions: [] });

    const fetchList = useCallback(async (p: number) => {
        const filter: Record<string, string> = {};
        if (filterName) filter.name = filterName;
        if (filterEmail) filter.email = filterEmail;

        const res = await accountApi.list({ page: p, filter });
        if (res.success && res.data) {
            setList(res?.data?.list.sort((a, _) => a.is_admin ? -1 : 1));
            setTotal(res.data.total);
        }
    }, [filterName, filterEmail]);

    useEffect(() => {
        fetchList(page);
    }, [page, fetchList]);

    const openCreate = () => {
        setFormMode("create");
        setForm({ name: "", email: "", password: "", is_admin: 0, permissions: [] });
        onFormOpen();
    };


    const openEdit = async (item: AccountDTO) => {
        setFormMode("edit");
        setEditId(item.id);

        // Fetch permissions for this account
        let permissions: string[] = [];
        if (!item.is_admin) {
            try {
                const rolesRes = await roleApi.account_roles({ account_id: item.id });
                if (rolesRes.success && rolesRes.data) {
                    permissions = rolesRes.data.roles.map(r => permToKey({ name: r.name, type: r.type }));
                }
            } catch { /* ignore */ }
        }

        setForm({ name: item.name, email: item.email, password: "", is_admin: item.is_admin, permissions });
        onFormOpen();
    };

    const assignPermissions = async (account_id: string, perms: string[]) => {
        const permissions = perms.map(key => {
            const [type, name] = key.split(":");
            return { name, type };
        });
        await roleApi.assign({
            account_id,
            roles: { permissions },
        });
    };

    const handleFormConfirm = async () => {
        if (formMode === "create") {
            const res = await accountApi.create({
                account: {
                    name: form.name,
                    email: form.email,
                    password: form.password,
                    api_key: "",
                    is_admin: 0,
                },
            });
            if (res.success && res.data?.account) {
                if (!form.is_admin && form.permissions.length > 0) {
                    await assignPermissions(res.data.account.id, form.permissions);
                }
                onFormClose();
                fetchList(1);
                setPage(1);
            }
        } else {
            const updateData: Record<string, any> = {};
            if (form.name) updateData.name = form.name;
            if (form.email) updateData.email = form.email;
            if (form.password) updateData.password = form.password;
            updateData.is_admin = form.is_admin;

            const res = await accountApi.update({
                id: editId,
                account: updateData,
            });
            if (res.success) {
                await assignPermissions(editId, form.permissions);
                onFormClose();
                fetchList(page);
            }
        }
    };

    const handleDelete = async (id: string) => {
        const res = await accountApi.delete({ id });
        if (res.success) {
            fetchList(page);
        }
    };

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={Locale("Menu").Account} />
            <div className="p-8 flex flex-col gap-4 flex-1 overflow-hidden">
                <AccountFilter
                    filterName={filterName}
                    filterEmail={filterEmail}
                    onNameChange={v => { setFilterName(v); setPage(1); }}
                    onEmailChange={v => { setFilterEmail(v); setPage(1); }}
                    onAdd={openCreate}
                />

                <AccountTable
                    list={list}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                />

                <AccountPagination page={page} total={total} onChange={setPage} />
            </div>

            <AccountFormModal
                isOpen={isFormOpen}
                onOpenChange={onFormOpenChange}
                mode={formMode}
                form={form}
                onFormChange={setForm}
                onConfirm={handleFormConfirm}
            />
        </div>
    );
}