import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { AccountDTO, AccountListRequest, AccountCreateRequest, AccountCreateBody, AccountUpdateRequest, AccountUpdateBody, AccountDeleteRequest, AccountQueryBody } from "../../../shared/modules/account/account.interface";
import { AccountRouter, RoleRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { useDisclosure } from "@heroui/react";
import { AccountFilter } from "./components/AccountFilter";
import { AccountTable } from "./components/AccountTable";
import { AccountPagination } from "./components/AccountPagination";
import { AccountFormModal, permToKey } from "./components/AccountFormModal";
import { AssignRolesRequest, AssignRolesBody, AccountRolesRequest } from "../../../shared/modules/role/role.interface";

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

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchList = useCallback(async (p: number) => {
        const filter: Record<string, string> = {};
        if (filterName) filter.name = filterName;
        if (filterEmail) filter.email = filterEmail;

        const req = new AccountListRequest({ page: p, filter: new AccountQueryBody(filter), auth: getToken() });
        const res = await AccountRouter.list(req);
        if (res.success && res.data) {
            setList(res.data.list);
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
                const rolesRes = await RoleRouter.account_roles(new AccountRolesRequest({ account_id: item.id, auth: getToken() }));
                if (rolesRes.success && rolesRes.data) {
                    permissions = rolesRes.data.roles.map(r => permToKey({ name: r.name, type: r.type }));
                }
            } catch { /* ignore */ }
        }

        setForm({ name: item.name, email: item.email, password: "", is_admin: item.is_admin, permissions });
        onFormOpen();
    };

    const assignPermissions = async (accountId: string, perms: string[]) => {
        const permissions = perms.map(key => {
            const [type, name] = key.split(":");
            return { name, type };
        });
        await RoleRouter.assign(new AssignRolesRequest({
            account_id: accountId,
            roles: new AssignRolesBody({ permissions }),
            auth: getToken(),
        }));
    };

    const handleFormConfirm = async () => {
        if (formMode === "create") {
            const req = new AccountCreateRequest({
                account: new AccountCreateBody({
                    name: form.name,
                    email: form.email,
                    password: form.password,
                    apiKey: "",
                    is_admin: 0,
                }),
                auth: getToken(),
            });
            const res = await AccountRouter.create(req);
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

            const req = new AccountUpdateRequest({
                id: editId,
                account: new AccountUpdateBody(updateData),
                auth: getToken(),
            });
            const res = await AccountRouter.update(req);
            if (res.success) {
                await assignPermissions(editId, form.permissions);
                onFormClose();
                fetchList(page);
            }
        }
    };

    const handleDelete = async (id: string) => {
        const req = new AccountDeleteRequest({ id, auth: getToken() });
        const res = await AccountRouter.delete(req);
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