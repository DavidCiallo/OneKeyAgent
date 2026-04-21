import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { ModelDTO } from "../../../shared/modules/model/model.entity";
import { ModelRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { useDisclosure } from "@heroui/react";
import {
    ModelListRequest,
    ModelCreateRequest,
    ModelCreateBody,
    ModelUpdateRequest,
    ModelUpdateBody,
    ModelDeleteRequest,
    ModelQueryBody,
} from "../../../shared/modules/model/model.interface";
import { ModelFilter } from "./components/ModelFilter";
import { ModelTable } from "./components/ModelTable";
import { ModelPagination } from "./components/ModelPagination";
import { ModelFormModal } from "./components/ModelFormModal";
import { ModelUsageCard } from "./components/ModelUsageCard";

type ModelForm = {
    tier: number;
    baseURL: string;
    model: string;
    alias?: string;
    apiKey?: string;
    proxyURL?: string;
};

export default function ModelPage() {
    const locale = Locale("ModelPage");

    const [list, setList] = useState<ModelDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    // Filter
    const [filterTier, setFilterTier] = useState<string>("");
    const [filterBaseURL, setFilterBaseURL] = useState("");

    // Form modal
    const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose, onOpenChange: onFormOpenChange } = useDisclosure();
    const [formMode, setFormMode] = useState<"create" | "edit">("create");
    const [editId, setEditId] = useState<string>("");
    const [form, setForm] = useState<ModelForm>({ tier: 1, baseURL: "", model: "" });

    // Usage modal
    const { isOpen: isUsageOpen, onOpen: onUsageOpen, onClose: onUsageClose, onOpenChange: onUsageOpenChange } = useDisclosure();
    const [usageModel, setUsageModel] = useState<ModelDTO | null>(null);

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchList = useCallback(async (p: number) => {
        const filter: Record<string, string | number> = {};
        if (filterTier) filter.tier = parseInt(filterTier);
        if (filterBaseURL) filter.baseURL = filterBaseURL;

        const req = new ModelListRequest({ page: p, filter: new ModelQueryBody(filter), auth: getToken() });
        const res = await ModelRouter.list(req);
        if (res.success && res.data) {
            setList(res.data.list);
            setTotal(res.data.total);
        }
    }, [filterTier, filterBaseURL]);

    useEffect(() => {
        fetchList(page);
    }, [page, fetchList]);

    const openCreate = () => {
        setFormMode("create");
        setForm({ tier: 1, baseURL: "", model: "", alias: "" });
        onFormOpen();
    };

    const openEdit = (item: ModelDTO) => {
        setFormMode("edit");
        setEditId(item.id);
        setForm({
            tier: item.tier,
            baseURL: item.baseURL,
            model: item.model,
            alias: item.alias || "",
            apiKey: item.apiKey || "",
            proxyURL: item.proxyURL || "",
        });
        onFormOpen();
    };

    const openUsage = (item: ModelDTO) => {
        setUsageModel(item);
        onUsageOpen();
    };

    const handleFormConfirm = async () => {
        if (formMode === "create") {
            const req = new ModelCreateRequest({
                model: new ModelCreateBody({
                    tier: form.tier,
                    baseURL: form.baseURL,
                    model: form.model,
                    alias: form.alias || undefined,
                    apiKey: form.apiKey || undefined,
                    proxyURL: form.proxyURL || undefined,
                }),
                auth: getToken(),
            });
            const res = await ModelRouter.create(req);
            if (res.success) {
                onFormClose();
                fetchList(1);
                setPage(1);
            }
        } else {
            const req = new ModelUpdateRequest({
                id: editId,
                model: new ModelUpdateBody({
                    tier: form.tier,
                    baseURL: form.baseURL,
                    model: form.model,
                    alias: form.alias || undefined,
                    apiKey: form.apiKey || undefined,
                    proxyURL: form.proxyURL || undefined,
                }),
                auth: getToken(),
            });
            const res = await ModelRouter.update(req);
            if (res.success) {
                onFormClose();
                fetchList(page);
            }
        }
    };

    const handleDelete = async (id: string) => {
        const req = new ModelDeleteRequest({ id, auth: getToken() });
        const res = await ModelRouter.delete(req);
        if (res.success) {
            fetchList(page);
        }
    };

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={Locale("Menu").Model} />
            <div className="p-8 flex flex-col gap-4 flex-1 overflow-hidden">
                <ModelFilter
                    filterTier={filterTier}
                    filterBaseURL={filterBaseURL}
                    onTierChange={v => { setFilterTier(v); setPage(1); }}
                    onBaseURLChange={v => { setFilterBaseURL(v); setPage(1); }}
                    onAdd={openCreate}
                />

                <ModelTable
                    list={list}
                    onEdit={openEdit}
                    onDelete={handleDelete}
                    onUsageClick={openUsage}
                />

                <ModelPagination page={page} total={total} onChange={setPage} />
            </div>

            <ModelFormModal
                isOpen={isFormOpen}
                onOpenChange={onFormOpenChange}
                mode={formMode}
                form={form}
                onFormChange={setForm}
                onConfirm={handleFormConfirm}
            />

            <ModelUsageCard
                isOpen={isUsageOpen}
                onOpenChange={onUsageOpenChange}
                model={usageModel}
            />
        </div>
    );
}