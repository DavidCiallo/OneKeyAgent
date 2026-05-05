import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback, useMemo } from "react";
import { ProviderDTO } from "../../../shared/modules/provider/provider.interface";
import { ProviderRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { useDisclosure } from "@heroui/react";
import { toast } from "../../methods/notify";
import {
    ProviderListRequest,
    ProviderCreateRequest,
    ProviderCreateBody,
    ProviderUpdateRequest,
    ProviderUpdateBody,
    ProviderDeleteRequest,
    ProviderQueryBody,
    ProviderSwapPriorityRequest,
} from "../../../shared/modules/provider/provider.interface";
import { ProviderFilter } from "./components/ProviderFilter";
import { ProviderTable } from "./components/ProviderTable";
import { ProviderPagination } from "./components/ProviderPagination";
import { ProviderFormModal } from "./components/ProviderFormModal";

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

export default function ProviderPage() {
    const locale = Locale("ProviderPage");

    const [list, setList] = useState<ProviderDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    const [filterModelAlias, setFilterModelAlias] = useState("");

    const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose, onOpenChange: onFormOpenChange } = useDisclosure();
    const [formMode, setFormMode] = useState<"create" | "edit">("create");
    const [editId, setEditId] = useState<string>("");
    const [form, setForm] = useState<ProviderForm>({ modelAlias: "", priority: 1, name: "", baseURL: "", model: "", authType: "bearer", enabled: 1 });

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchList = useCallback(async (p: number) => {
        const filter: Record<string, string | number> = {};
        if (filterModelAlias) filter.modelAlias = filterModelAlias;

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

    // Sort by modelAlias ASC first, then by priority ASC
    const sortedList = useMemo(() => {
        return [...list].sort((a, b) => a.modelAlias.localeCompare(b.modelAlias) || a.priority - b.priority);
    }, [list]);

    const handleSwap = async (id1: string, id2: string, alias1: string, alias2: string, samePriority: boolean) => {
        if (samePriority) {
            toast({ color: "warning", title: "相同优先级，无需交换" });
            return;
        }
        if (alias1 !== alias2) {
            toast({ color: "warning", title: "不同模型别名的 Provider 不能交换优先级" });
            return;
        }
        const req = new ProviderSwapPriorityRequest({ id1, id2, auth: getToken() });
        const res = await ProviderRouter.swappriority(req);
        if (res.success) {
            fetchList(page);
        }
    };

    const openCreate = () => {
        setFormMode("create");
        setForm({ modelAlias: "", priority: 1, name: "", baseURL: "", model: "", authType: "bearer", enabled: 1 });
        onFormOpen();
    };

    const handleCopy = async (item: ProviderDTO) => {
        const req = new ProviderCreateRequest({
            provider: new ProviderCreateBody({
                modelAlias: item.modelAlias,
                priority: item.priority,
                name: item.name,
                baseURL: item.baseURL,
                model: item.model,
                apiKey: item.apiKey || undefined,
                authType: item.authType || undefined,
                proxyURL: item.proxyURL || undefined,
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
            modelAlias: item.modelAlias,
            priority: item.priority,
            name: item.name,
            baseURL: item.baseURL,
            model: item.model,
            apiKey: item.apiKey || "",
            authType: item.authType || "bearer",
            proxyURL: item.proxyURL || "",
            enabled: item.enabled,
        });
        onFormOpen();
    };

    const handleFormConfirm = async () => {
        if (formMode === "create") {
            const req = new ProviderCreateRequest({
                provider: new ProviderCreateBody({
                    modelAlias: form.modelAlias,
                    priority: form.priority,
                    name: form.name,
                    baseURL: form.baseURL,
                    model: form.model,
                    apiKey: form.apiKey || undefined,
                    authType: form.authType,
                    proxyURL: form.proxyURL || undefined,
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
                    modelAlias: form.modelAlias || undefined,
                    priority: form.priority !== undefined ? form.priority : undefined,
                    name: form.name || undefined,
                    baseURL: form.baseURL || undefined,
                    model: form.model || undefined,
                    apiKey: form.apiKey !== undefined ? form.apiKey : undefined,
                    authType: form.authType,
                    proxyURL: form.proxyURL !== undefined ? form.proxyURL : undefined,
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
                    onMoveUp={(item, prev) => {
                        if (!prev) return;
                        handleSwap(item.id, prev.id, item.modelAlias, prev.modelAlias, item.priority === prev.priority);
                    }}
                    onMoveDown={(item, next) => {
                        if (!next) return;
                        handleSwap(item.id, next.id, item.modelAlias, next.modelAlias, item.priority === next.priority);
                    }}
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
