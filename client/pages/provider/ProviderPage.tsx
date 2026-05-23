import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback, useMemo } from "react";
import { ProviderDTO } from "../../../shared/modules/provider/provider.interface";
import { ProviderRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { useDisclosure } from "@heroui/react";
import {
    ProviderListRequest,
    ProviderCreateRequest,
    ProviderCreateBody,
    ProviderUpdateRequest,
    ProviderUpdateBody,
    ProviderDeleteRequest,
    ProviderQueryBody,
    ProviderUpdatePriorityRequest,
} from "../../../shared/modules/provider/provider.interface";
import { ProviderFilter } from "./components/ProviderFilter";
import { ProviderTable } from "./components/ProviderTable";
import { ProviderPagination } from "./components/ProviderPagination";
import { ProviderFormModal } from "./components/ProviderFormModal";

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
    enabled: number;
};

export default function ProviderPage() {

    const [list, setList] = useState<ProviderDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    const [filterModelAlias, setFilterModelAlias] = useState("");

    const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose, onOpenChange: onFormOpenChange } = useDisclosure();
    const [formMode, setFormMode] = useState<"create" | "edit">("create");
    const [editId, setEditId] = useState<string>("");
    const [form, setForm] = useState<ProviderForm>({ model_alias: "", priority: 1, name: "", base_url: "", model: "", auth_type: "bearer", api_type: "openai", enabled: 1 });

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchList = useCallback(async (p: number) => {
        const filter: Record<string, string | number> = {};
        if (filterModelAlias) filter.model_alias = filterModelAlias;

        const req = new ProviderListRequest({ page: p, filter: new ProviderQueryBody(filter), auth: getToken() });
        const res = await ProviderRouter.list(req);
        if (res.success && res.data) {
            setList(res.data.list);
            setTotal(res.data.total);
        }
    }, [filterModelAlias]);

    useEffect(() => {
        fetchList(page);
    }, [page, fetchList]);

    // Sort by model_alias ASC first, then by priority ASC
    const sortedList = useMemo(() => {
        return [...list].sort((a, b) => a.model_alias.localeCompare(b.model_alias) || a.priority - b.priority);
    }, [list]);

    const handleMoveUp = async (id: string) => {
        const req = new ProviderUpdatePriorityRequest({ id, delta: -1, auth: getToken() });
        const res = await ProviderRouter.updatepriority(req);
        if (res.success) fetchList(page);
    };

    const handleMoveDown = async (id: string) => {
        const req = new ProviderUpdatePriorityRequest({ id, delta: 1, auth: getToken() });
        const res = await ProviderRouter.updatepriority(req);
        if (res.success) fetchList(page);
    };

    const openCreate = () => {
        setFormMode("create");
        setForm({ model_alias: "", priority: 1, name: "", base_url: "", model: "", auth_type: "bearer", api_type: "openai", enabled: 1 });
        onFormOpen();
    };

    const handleCopy = async (item: ProviderDTO) => {
        const req = new ProviderCreateRequest({
            provider: new ProviderCreateBody({
                model_alias: item.model_alias,
                priority: item.priority,
                name: item.name,
                base_url: item.base_url,
                model: item.model,
                api_key: item.api_key || undefined,
                auth_type: item.auth_type || undefined,
                api_type: item.api_type || undefined,
                proxy_url: item.proxy_url || undefined,
                enabled: item.enabled,
            }),
            auth: getToken(),
        });
        const res = await ProviderRouter.create(req);
        if (res.success) {
            fetchList(page);
        }
    };

    const openEdit = (item: ProviderDTO) => {
        setFormMode("edit");
        setEditId(item.id);
        setForm({
            model_alias: item.model_alias,
            priority: item.priority,
            name: item.name,
            base_url: item.base_url,
            model: item.model,
            api_key: item.api_key || "",
            auth_type: item.auth_type || "bearer",
            api_type: item.api_type || "openai",
            proxy_url: item.proxy_url || "",
            enabled: item.enabled,
        });
        onFormOpen();
    };

    const handleFormConfirm = async () => {
        if (formMode === "create") {
            const req = new ProviderCreateRequest({
                provider: new ProviderCreateBody({
                    model_alias: form.model_alias,
                    priority: form.priority,
                    name: form.name,
                    base_url: form.base_url,
                    model: form.model,
                    api_key: form.api_key || undefined,
                    auth_type: form.auth_type,
                    api_type: form.api_type,
                    proxy_url: form.proxy_url || undefined,
                    enabled: form.enabled,
                }),
                auth: getToken(),
            });
            const res = await ProviderRouter.create(req);
            if (res.success) {
                onFormClose();
                fetchList(1);
                setPage(1);
            }
        } else {
            const req = new ProviderUpdateRequest({
                id: editId,
                provider: new ProviderUpdateBody({
                    model_alias: form.model_alias || undefined,
                    priority: form.priority !== undefined ? form.priority : undefined,
                    name: form.name || undefined,
                    base_url: form.base_url || undefined,
                    model: form.model || undefined,
                    api_key: form.api_key !== undefined ? form.api_key : undefined,
                    auth_type: form.auth_type,
                    api_type: form.api_type,
                    proxy_url: form.proxy_url !== undefined ? form.proxy_url : undefined,
                    enabled: form.enabled !== undefined ? form.enabled : undefined,
                }),
                auth: getToken(),
            });
            const res = await ProviderRouter.update(req);
            if (res.success) {
                onFormClose();
                fetchList(page);
            }
        }
    };

    const handleDelete = async (id: string) => {
        const req = new ProviderDeleteRequest({ id, auth: getToken() });
        const res = await ProviderRouter.delete(req);
        if (res.success) {
            fetchList(page);
        }
    };

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={Locale("Menu").Provider} />
            <div className="p-8 flex flex-col gap-4 flex-1 overflow-hidden">
                <ProviderFilter
                    filterModelAlias={filterModelAlias}
                    onModelAliasChange={v => { setFilterModelAlias(v); setPage(1); }}
                    onAdd={openCreate}
                />

                <ProviderTable
                    list={sortedList}
                    onEdit={openEdit}
                    onCopy={handleCopy}
                    onDelete={handleDelete}
                    onMoveUp={(item) => handleMoveUp(item.id)}
                    onMoveDown={(item) => handleMoveDown(item.id)}
                />

                <ProviderPagination page={page} total={total} onChange={setPage} />
            </div>

            <ProviderFormModal
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
