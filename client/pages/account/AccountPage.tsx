import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { AccountDTO, AccountListRequest, AccountCreateRequest, AccountCreateBody, AccountUpdateRequest, AccountUpdateBody, AccountDeleteRequest, AccountQueryBody } from "../../../shared/modules/account/account.interface";
import { AccountRole } from "../../../shared/modules/account/account.entity";
import { AccountRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { useDisclosure } from "@heroui/react";
import { AccountFilter } from "./components/AccountFilter";
import { AccountTable } from "./components/AccountTable";
import { AccountPagination } from "./components/AccountPagination";
import { AccountFormModal } from "./components/AccountFormModal";

type AccountForm = {
    name: string;
    email: string;
    password: string;
    role: AccountRole;
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
    const [form, setForm] = useState<AccountForm>({ name: "", email: "", password: "", role: "user" as AccountRole });

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
        setForm({ name: "", email: "", password: "", role: "user" as AccountRole });
        onFormOpen();
    };

    const openEdit = (item: AccountDTO) => {
        setFormMode("edit");
        setEditId(item.id);
        setForm({ name: item.name, email: item.email, password: "", role: item.role as AccountRole });
        onFormOpen();
    };

    const handleFormConfirm = async () => {
        if (formMode === "create") {
            const req = new AccountCreateRequest({
                account: new AccountCreateBody({
                    name: form.name,
                    email: form.email,
                    password: form.password,
                    apiKey: "",
                    role: form.role,
                }),
                auth: getToken(),
            });
            const res = await AccountRouter.create(req);
            if (res.success) {
                onFormClose();
                fetchList(1);
                setPage(1);
            }
        } else {
            const updateData: Record<string, string> = {};
            if (form.name) updateData.name = form.name;
            if (form.email) updateData.email = form.email;
            if (form.password) updateData.password = form.password;
            if (form.role) updateData.role = form.role;

            const req = new AccountUpdateRequest({
                id: editId,
                account: new AccountUpdateBody(updateData),
                auth: getToken(),
            });
            const res = await AccountRouter.update(req);
            if (res.success) {
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