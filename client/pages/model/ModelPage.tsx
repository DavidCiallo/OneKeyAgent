import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { ModelDTO } from "../../../shared/modules/model/model.entity";
import { ModelRouter, UsageRouter } from "../../api/instance";
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
import { UsageStatsRequest, UsageStatsPeriod, UsageAmountData } from "../../../shared/modules/usage/usage.interface";
import { ModelCardGrid } from "./components/ModelCardGrid";
import { ModelPagination } from "./components/ModelPagination";
import { ModelFormModal } from "./components/ModelFormModal";

type ModelForm = {
    tier: number;
    alias?: string;
};

export default function ModelPage() {
    const locale = Locale("ModelPage");

    const [list, setList] = useState<ModelDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    // Filter
    const [filterTier, setFilterTier] = useState<string>("");

    // Per-model usage stats
    const [usageMap, setUsageMap] = useState<Record<string, { todayPeriod: UsageStatsPeriod; last24hPeriod: UsageStatsPeriod; weekPeriod: UsageStatsPeriod }>>({});

    // Form modal
    const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose, onOpenChange: onFormOpenChange } = useDisclosure();
    const [formMode, setFormMode] = useState<"create" | "edit">("create");
    const [editId, setEditId] = useState<string>("");
    const [form, setForm] = useState<ModelForm>({ tier: 1 });


    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchList = useCallback(async (p: number) => {
        const filter: Record<string, string | number> = {};
        if (filterTier) filter.tier = parseInt(filterTier);

        const req = new ModelListRequest({ page: p, filter: new ModelQueryBody(filter), auth: getToken() });
        const res = await ModelRouter.list(req);
        if (res.success && res.data) {
            setList(res.data.list);
            setTotal(res.data.total);

            // Fetch usage stats for each model
            const map: Record<string, { todayPeriod: UsageStatsPeriod; last24hPeriod: UsageStatsPeriod; weekPeriod: UsageStatsPeriod }> = {};
            await Promise.all(res.data.list.map(async (item) => {
                try {
                    const statsReq = new UsageStatsRequest({ modelAlias: item.alias, auth: getToken() });
                    const statsRes = await UsageRouter.stats(statsReq);
                    if (statsRes.success && statsRes.data) {
                        map[item.id] = {
                            todayPeriod: statsRes.data.today,
                            last24hPeriod: statsRes.data.last24h,
                            weekPeriod: statsRes.data.last7Days,
                        };
                    }
                } catch {}
            }));
            setUsageMap(map);
        }
    }, [filterTier]);

    useEffect(() => {
        fetchList(page);
    }, [page, fetchList]);

    const openCreate = () => {
        setFormMode("create");
        setForm({ tier: 1, alias: "" });
        onFormOpen();
    };

    const openEdit = (item: ModelDTO) => {
        setFormMode("edit");
        setEditId(item.id);
        setForm({
            tier: item.tier,
            alias: item.alias || "",
        });
        onFormOpen();
    };

    const handleFormConfirm = async () => {
        if (formMode === "create") {
            const req = new ModelCreateRequest({
                model: new ModelCreateBody({
                    tier: form.tier,
                    alias: form.alias || "",
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
                    alias: form.alias || undefined,
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
                <ModelCardGrid
                    list={list.map(item => ({ ...item, ...usageMap[item.id] }))}
                    onEdit={openEdit}
                    onDelete={handleDelete}
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

        </div>
    );
}
