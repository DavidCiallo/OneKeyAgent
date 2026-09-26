import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback, useMemo } from "react";
import { ProviderDTO } from "../../../shared/modules/provider/provider.interface";
import { providerApi } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { useDisclosure } from "@heroui/react";
import { ProviderFilter } from "./components/ProviderFilter";
import { ProviderCardGrid } from "./components/ProviderCardGrid";
import { ProviderPagination } from "./components/ProviderPagination";
import { ProviderFormModal } from "./components/ProviderFormModal";
import { ProviderBatchModal } from "./components/ProviderBatchModal";

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
    extra_json?: string;
    supports_thinking: number;
    supports_reasoning_effort: number;
    replay_reasoning: number;
    enable_search: number;
    enabled: number;
    max_context: number;
    daily_quota: number;
};

// 0 = no limit for both composite fields.
const emptyForm = (): ProviderForm => ({
    model_alias: "", priority: 1, name: "", base_url: "", model: "",
    auth_type: "bearer", api_type: "openai", extra_json: "",
    supports_thinking: 0, supports_reasoning_effort: 0, replay_reasoning: 0,
    enable_search: 0, enabled: 1, max_context: 0, daily_quota: 0,
});

export default function ProviderPage() {

    const [list, setList] = useState<ProviderDTO[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    const [filterModelAlias, setFilterModelAlias] = useState("");

    const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose, onOpenChange: onFormOpenChange } = useDisclosure();
    const [formMode, setFormMode] = useState<"create" | "edit">("create");
    const [editId, setEditId] = useState<string>("");
    const [form, setForm] = useState<ProviderForm>(emptyForm());

    // Multi-select state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const { isOpen: isBatchOpen, onOpen: onBatchOpen, onClose: onBatchClose, onOpenChange: onBatchOpenChange } = useDisclosure();

    // The page is organised per model alias: the filter is mandatory and the
    // list starts on the first alias instead of an empty "all providers" view.
    const [modelAliasOptions, setModelAliasOptions] = useState<string[]>([]);
    const [aliasLoaded, setAliasLoaded] = useState(false);

    // Reloaded after every write: creating, renaming or deleting a provider can
    // add an alias, empty one out, or drop the last one — and a picker offering
    // a chain with nothing in it renders as a blank page. `select` forces the
    // view onto a specific alias (the one just written to); otherwise the
    // current selection is kept while it still exists.
    const loadAliases = useCallback(async (select?: string) => {
        const res: any = await providerApi.modelaliases({});
        if (res.success && Array.isArray(res.data)) {
            setModelAliasOptions(res.data);
            setFilterModelAlias(prev => select || (prev && res.data.includes(prev) ? prev : res.data[0] || ""));
        }
        setAliasLoaded(true);
    }, []);

    useEffect(() => {
        loadAliases();
    }, [loadAliases]);

    // Switching alias drops the selection: it is scoped to the chain on screen,
    // and a batch action on rows the admin can no longer see is a trap.
    const handleAliasChange = (v: string) => {
        setFilterModelAlias(v);
        setSelectedIds(new Set());
        setPage(1);
    };

    // Fetch only once an alias is settled, so the first request already carries
    // the filter instead of firing an unfiltered one.
    const fetchList = useCallback(async (p: number) => {
        if (!filterModelAlias) return;
        const filter: Record<string, string | number> = { model_alias: filterModelAlias };

        const res = await providerApi.list({ page: p, filter });
        if (res.success && res.data) {
            setList(res.data.list);
            setTotal(res.data.total);
        }
    }, [filterModelAlias]);

    useEffect(() => {
        if (!aliasLoaded) return;
        fetchList(page);
    }, [page, fetchList, aliasLoaded]);

    // Sort by model_alias ASC first, then by priority ASC
    const sortedList = useMemo(() => {
        return [...list].sort((a, b) => a.model_alias.localeCompare(b.model_alias) || a.priority - b.priority);
    }, [list]);

    const allSelected = sortedList.length > 0 && sortedList.every(item => selectedIds.has(item.id));

    const handleMoveUp = async (id: string) => {
        const res = await providerApi.updatepriority({ id, delta: -1 });
        if (res.success) fetchList(page);
    };

    const handleMoveDown = async (id: string) => {
        const res = await providerApi.updatepriority({ id, delta: 1 });
        if (res.success) fetchList(page);
    };

    // A new provider joins the chain currently on screen: alias and position
    // are pre-filled from what the admin is looking at.
    const nextPriority = useMemo(() => {
        const highest = sortedList.reduce((max, item) => Math.max(max, item.priority), 0);
        return Math.min(highest + 1, 5);
    }, [sortedList]);

    const openCreate = () => {
        setFormMode("create");
        setForm({ ...emptyForm(), model_alias: filterModelAlias, priority: nextPriority });
        onFormOpen();
    };

    const handleCopy = async (item: ProviderDTO) => {
        const res = await providerApi.create({
            provider: {
                model_alias: item.model_alias,
                priority: item.priority,
                name: `${item.name}_copy`,
                base_url: item.base_url,
                model: item.model,
                api_key: item.api_key || undefined,
                auth_type: item.auth_type || undefined,
                api_type: item.api_type || undefined,
                proxy_url: item.proxy_url || undefined,
                supports_thinking: item.supports_thinking ?? 0,
                supports_reasoning_effort: item.supports_reasoning_effort ?? 0,
                replay_reasoning: item.replay_reasoning ?? 0,
                enable_search: item.enable_search ?? 0,
                extra_json: item.extra_json || undefined,
                enabled: item.enabled,
                max_context: item.max_context ?? 0,
                daily_quota: item.daily_quota ?? 0,
            },
        });
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
            extra_json: item.extra_json || "",
            supports_thinking: item.supports_thinking ?? 0,
            supports_reasoning_effort: item.supports_reasoning_effort ?? 0,
            replay_reasoning: item.replay_reasoning ?? 0,
            enable_search: item.enable_search ?? 0,
            enabled: item.enabled,
            max_context: item.max_context ?? 0,
            daily_quota: item.daily_quota ?? 0,
        });
        onFormOpen();
    };

    const handleFormConfirm = async () => {
        if (formMode === "create") {
            const res = await providerApi.create({
                provider: {
                    model_alias: form.model_alias,
                    priority: form.priority,
                    name: form.name,
                    base_url: form.base_url,
                    model: form.model,
                    api_key: form.api_key || undefined,
                    auth_type: form.auth_type,
                    api_type: form.api_type,
                    proxy_url: form.proxy_url || undefined,
                    supports_thinking: form.supports_thinking,
                    supports_reasoning_effort: form.supports_reasoning_effort,
                    replay_reasoning: form.replay_reasoning,
                    enable_search: form.enable_search,
                    extra_json: form.extra_json || undefined,
                    enabled: form.enabled,
                    max_context: form.max_context,
                    daily_quota: form.daily_quota,
                },
            });
            if (res.success) {
                onFormClose();
                // Land on the chain that was just written to, and pick up an
                // alias this create may have introduced.
                await loadAliases(form.model_alias);
                setSelectedIds(new Set());
                setPage(1);
                if (form.model_alias === filterModelAlias) fetchList(1);
            }
        } else {
            const res = await providerApi.update({
                id: editId,
                provider: {
                    model_alias: form.model_alias || undefined,
                    priority: form.priority !== undefined ? form.priority : undefined,
                    name: form.name || undefined,
                    base_url: form.base_url || undefined,
                    model: form.model || undefined,
                    api_key: form.api_key !== undefined ? form.api_key : undefined,
                    auth_type: form.auth_type,
                    api_type: form.api_type,
                    proxy_url: form.proxy_url !== undefined ? form.proxy_url : undefined,
                    supports_thinking: form.supports_thinking,
                    supports_reasoning_effort: form.supports_reasoning_effort,
                    replay_reasoning: form.replay_reasoning !== undefined ? form.replay_reasoning : undefined,
                    enable_search: form.enable_search !== undefined ? form.enable_search : undefined,
                    extra_json: form.extra_json !== undefined ? form.extra_json : undefined,
                    enabled: form.enabled !== undefined ? form.enabled : undefined,
                    max_context: form.max_context !== undefined ? form.max_context : undefined,
                    daily_quota: form.daily_quota !== undefined ? form.daily_quota : undefined,
                },
            });
            if (res.success) {
                onFormClose();
                // An edit can move a provider to a different alias, which may
                // leave the chain on screen empty or drop it entirely.
                await loadAliases(form.model_alias);
                fetchList(page);
            }
        }
    };

    const handleDelete = async (id: string) => {
        const res = await providerApi.delete({ id });
        if (res.success) {
            // The last provider of a chain may have just gone.
            await loadAliases();
            fetchList(page);
        }
    };

    // Multi-select handlers
    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSelectAll = () => {
        setSelectedIds(prev => {
            const allOnPage = sortedList.map(i => i.id);
            const allSelected = allOnPage.every(id => prev.has(id));
            if (allSelected) {
                const next = new Set(prev);
                allOnPage.forEach(id => next.delete(id));
                return next;
            } else {
                const next = new Set(prev);
                allOnPage.forEach(id => next.add(id));
                return next;
            }
        });
    };

    const clearSelection = () => setSelectedIds(new Set());

    const handleBatchEnable = async (enabled: number) => {
        const res = await providerApi.batchupdate({ body: { ids: Array.from(selectedIds), enabled } });
        if (res.success) {
            clearSelection();
            fetchList(page);
        }
    };

    const handleBatchProxy = async (proxyUrl: string) => {
        const res = await providerApi.batchupdate({ body: { ids: Array.from(selectedIds), proxy_url: proxyUrl } });
        if (res.success) {
            onBatchClose();
            clearSelection();
            fetchList(page);
        }
    };

    const handleBatchThinking = async (supports_thinking: number) => {
        const res = await providerApi.batchupdate({ body: { ids: Array.from(selectedIds), supports_thinking } });
        if (res.success) {
            clearSelection();
            fetchList(page);
        }
    };

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={Locale("Menu").Provider} />
            <div className="p-8 flex flex-col gap-4 flex-1 overflow-hidden">
                <ProviderFilter
                    filterModelAlias={filterModelAlias}
                    onModelAliasChange={handleAliasChange}
                    onAdd={openCreate}
                    modelAliasOptions={modelAliasOptions}
                    selectedCount={selectedIds.size}
                    allSelected={allSelected}
                    onToggleSelectAll={toggleSelectAll}
                    onBatchEnable={() => handleBatchEnable(1)}
                    onBatchDisable={() => handleBatchEnable(0)}
                    onBatchThinkingOn={() => handleBatchThinking(1)}
                    onBatchThinkingOff={() => handleBatchThinking(0)}
                    onBatchProxy={onBatchOpen}
                    onClearSelection={clearSelection}
                />

                <ProviderCardGrid
                    list={sortedList}
                    onEdit={openEdit}
                    onCopy={handleCopy}
                    onDelete={handleDelete}
                    onMoveUp={(item) => handleMoveUp(item.id)}
                    onMoveDown={(item) => handleMoveDown(item.id)}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelect}
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

            <ProviderBatchModal
                isOpen={isBatchOpen}
                onOpenChange={onBatchOpenChange}
                onConfirm={handleBatchProxy}
            />
        </div>
    );
}
