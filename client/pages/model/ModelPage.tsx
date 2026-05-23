import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { ModelDTO } from "../../../shared/modules/model/model.entity";
import { modelApi, usageApi } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { useDisclosure, Button } from "@heroui/react";
import { UsageStatsPeriod } from "../../../shared/modules/usage/usage.interface";
import { ModelCardGrid } from "./components/ModelCardGrid";
import { ModelPagination } from "./components/ModelPagination";
import { ModelFormModal } from "./components/ModelFormModal";

type ModelForm = {
    alias?: string;
    input_price: number;
    output_price: number;
    is_public?: number;
};

export default function ModelPage() {
    const locale = Locale("ModelPage");

    const [list, setList] = useState<ModelDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    // Per-model usage stats
    const [usageMap, setUsageMap] = useState<Record<string, { todayPeriod: UsageStatsPeriod; last24hPeriod: UsageStatsPeriod; weekPeriod: UsageStatsPeriod }>>({});

    // Form modal
    const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose, onOpenChange: onFormOpenChange } = useDisclosure();
    const [formMode, setFormMode] = useState<"create" | "edit">("create");
    const [editId, setEditId] = useState<string>("");
    const [form, setForm] = useState<ModelForm>({ input_price: 0, output_price: 0 });


    const fetchList = useCallback(async (p: number) => {
        const filter: Record<string, string | number> = {};

        const res = await modelApi.list({ page: p, filter } as any);
        if (res.success && res.data) {
            setList(res.data.list);
            setTotal(res.data.total);

            // Fetch usage stats for each model
            const map: Record<string, { todayPeriod: UsageStatsPeriod; last24hPeriod: UsageStatsPeriod; weekPeriod: UsageStatsPeriod }> = {};
            await Promise.all(res.data.list.map(async (item) => {
                try {
                    const statsRes = await usageApi.stats({ model_alias: item.alias } as any);
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
    }, []);

    useEffect(() => {
        fetchList(page);
    }, [page, fetchList]);

    const openCreate = () => {
        setFormMode("create");
        setForm({ alias: "", input_price: 0, output_price: 0, is_public: 0 });
        onFormOpen();
    };

    const openEdit = (item: ModelDTO) => {
        setFormMode("edit");
        setEditId(item.id);
        setForm({
            alias: item.alias || "",
            input_price: item.input_price,
            output_price: item.output_price,
            is_public: item.is_public,
        });
        onFormOpen();
    };

    const handleFormConfirm = async () => {
        if (formMode === "create") {
            const res = await modelApi.create({
                model: {
                    alias: form.alias || "",
                    input_price: form.input_price,
                    output_price: form.output_price,
                    is_public: form.is_public ?? 0,
                },
            } as any);
            if (res.success) {
                onFormClose();
                fetchList(1);
                setPage(1);
            }
        } else {
            const res = await modelApi.update({
                id: editId,
                model: {
                    alias: form.alias || undefined,
                    input_price: form.input_price,
                    output_price: form.output_price,
                    is_public: form.is_public,
                },
            } as any);
            if (res.success) {
                onFormClose();
                fetchList(page);
            }
        }
    };

    const handleDelete = async (id: string) => {
        const res = await modelApi.delete({ id } as any);
        if (res.success) {
            fetchList(page);
        }
    };

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={Locale("Menu").Model} />
            <div className="p-8 flex flex-col gap-4 flex-1 overflow-hidden">
                <div className="flex justify-end">
                    <Button color="primary" onPress={openCreate}>{locale.CreateModel}</Button>
                </div>
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
