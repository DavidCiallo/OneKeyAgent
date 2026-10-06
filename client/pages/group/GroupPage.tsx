import { useCallback, useEffect, useMemo, useState } from "react";
import {
    Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader,
    Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, useDisclosure,
} from "@heroui/react";
import { Header } from "../../components/header/Header";
import { groupApi, accountApi } from "../../api/instance";
import { AccountGroupDTO } from "../../../shared/modules/group/group.interface";
import { Locale } from "../../methods/locale";

type AccountOption = { id: string; name: string; email: string };

export default function GroupPage() {
    const locale = Locale("GroupPage");
    const [groups, setGroups] = useState<AccountGroupDTO[]>([]);
    const [accounts, setAccounts] = useState<AccountOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [msg, setMsg] = useState("");

    // Editor state. `memberIds` is the draft the checkboxes write to; it is only
    // sent on save, so closing the modal discards the edit.
    const [editing, setEditing] = useState<AccountGroupDTO | null>(null);
    const [formName, setFormName] = useState("");
    const [formRemark, setFormRemark] = useState("");
    const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
    const [memberFilter, setMemberFilter] = useState("");
    const [saving, setSaving] = useState(false);

    const { isOpen, onOpen, onOpenChange } = useDisclosure();
    const [isCreate, setIsCreate] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<AccountGroupDTO | null>(null);
    const deleteDisclosure = useDisclosure();

    const loadGroups = useCallback(async () => {
        const res = await groupApi.list({});
        if (res.success && res.data) {
            setGroups(res.data.list);
        }
    }, []);

    // Account options come from the same paged endpoint the usage page uses.
    const loadAccounts = useCallback(async () => {
        const res = await accountApi.list({ page: 1, filter: {} });
        if (!(res.success && res.data)) return;
        const totalPages = Math.max(1, Math.ceil((res.data.total || 0) / 10));
        const rest = totalPages > 1
            ? await Promise.all(
                Array.from({ length: totalPages - 1 }, (_, i) => accountApi.list({ page: i + 2, filter: {} })))
            : [];
        const all = [res.data.list, ...rest.map((p: any) => p.data?.list || [])].flat();
        setAccounts(all.map((a: any) => ({ id: a.id, name: a.name, email: a.email })));
    }, []);

    useEffect(() => {
        setLoading(true);
        Promise.all([loadGroups(), loadAccounts()]).finally(() => setLoading(false));
    }, [loadGroups, loadAccounts]);

    const openCreate = () => {
        setIsCreate(true);
        setEditing(null);
        setFormName("");
        setFormRemark("");
        setMemberIds(new Set());
        setMemberFilter("");
        onOpen();
    };

    const openEdit = async (g: AccountGroupDTO) => {
        setIsCreate(false);
        setEditing(g);
        setFormName(g.name);
        setFormRemark(g.remark || "");
        setMemberFilter("");
        // Membership is fetched per group rather than read off the list row: the
        // list carries only a count, and showing the wrong members would be
        // worse than an extra round trip.
        const res = await groupApi.detail({ id: g.id });
        if (res.success && res.data) {
            setMemberIds(new Set(res.data.member_ids));
        } else {
            setMemberIds(new Set());
        }
        onOpen();
    };

    const handleSave = async () => {
        if (!formName.trim()) {
            setMsg(locale.NameRequired || "Name is required");
            return;
        }
        setSaving(true);
        setMsg("");
        let id = editing?.id;
        if (isCreate) {
            const res = await groupApi.create({ name: formName.trim(), remark: formRemark });
            if (!res.success || !res.data) {
                setMsg(res.message || "Save failed");
                setSaving(false);
                return;
            }
            id = res.data.group.id;
        } else if (editing) {
            const res = await groupApi.update({ id: editing.id, name: formName.trim(), remark: formRemark });
            if (!res.success) {
                setMsg(res.message || "Save failed");
                setSaving(false);
                return;
            }
        }
        if (id) {
            const res = await groupApi.assign({ id, account_ids: Array.from(memberIds) });
            if (!res.success) {
                setMsg(res.message || "Save failed");
                setSaving(false);
                return;
            }
        }
        setSaving(false);
        onOpenChange();
        await loadGroups();
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        await groupApi.delete({ id: deleteTarget.id });
        deleteDisclosure.onClose();
        setDeleteTarget(null);
        await loadGroups();
    };

    const toggleMember = (id: string) => {
        setMemberIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const visibleAccounts = useMemo(() => {
        const q = memberFilter.trim().toLowerCase();
        if (!q) return accounts;
        return accounts.filter(a =>
            a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q));
    }, [accounts, memberFilter]);

    return (
        <div className="max-w-screen flex flex-col min-h-screen">
            <Header name={locale.Title || "Groups"} />
            <div className="p-3 md:p-12 flex flex-col gap-4 flex-1 overflow-auto">
                <div className="flex flex-row items-center justify-between flex-wrap gap-3">
                    <div className="flex flex-row items-center gap-3">
                        <span className="font-medium">{locale.Title || "Groups"}</span>
                        {msg && <span className="text-sm text-danger">{msg}</span>}
                    </div>
                    <Button color="primary" size="sm" onPress={openCreate}>
                        {locale.Add || "Add Group"}
                    </Button>
                </div>

                {loading ? (
                    <div className="text-center text-default-400 py-12">{locale.Loading || "Loading..."}</div>
                ) : (
                    <Table aria-label="Account groups">
                        <TableHeader>
                            <TableColumn>{locale.Name || "Name"}</TableColumn>
                            <TableColumn>{locale.Remark || "Remark"}</TableColumn>
                            <TableColumn>{locale.Members || "Members"}</TableColumn>
                            <TableColumn>{locale.Actions || "Actions"}</TableColumn>
                        </TableHeader>
                        <TableBody emptyContent={locale.Empty || "No groups yet"} items={groups}>
                            {(g) => (
                                <TableRow key={g.id}>
                                    <TableCell className="font-medium">{g.name}</TableCell>
                                    <TableCell className="text-default-500">{g.remark}</TableCell>
                                    <TableCell>{g.member_count}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-row gap-2">
                                            <Button size="sm" variant="flat" onPress={() => openEdit(g)}>
                                                {locale.Edit || "Edit"}
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant="flat"
                                                color="danger"
                                                onPress={() => { setDeleteTarget(g); deleteDisclosure.onOpen(); }}
                                            >
                                                {locale.Delete || "Delete"}
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                )}
            </div>

            <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl" scrollBehavior="inside">
                <ModalContent>
                    <ModalHeader>{isCreate ? (locale.Add || "Add Group") : (locale.Edit || "Edit")}</ModalHeader>
                    <ModalBody>
                        <div className="flex flex-col gap-4">
                            <Input
                                label={locale.Name || "Name"}
                                value={formName}
                                onValueChange={setFormName}
                                isRequired
                            />
                            <Input
                                label={locale.Remark || "Remark"}
                                value={formRemark}
                                onValueChange={setFormRemark}
                            />
                            <div className="flex flex-col gap-2">
                                <div className="flex flex-row items-center justify-between gap-3">
                                    <span className="text-sm font-medium">
                                        {locale.Members || "Members"} ({memberIds.size})
                                    </span>
                                    <div className="flex flex-row gap-2">
                                        <Button
                                            size="sm"
                                            variant="flat"
                                            onPress={() => setMemberIds(new Set(visibleAccounts.map(a => a.id)))}
                                        >
                                            {locale.SelectAll || "Select all"}
                                        </Button>
                                        <Button size="sm" variant="flat" onPress={() => setMemberIds(new Set())}>
                                            {locale.Clear || "Clear"}
                                        </Button>
                                    </div>
                                </div>
                                <Input
                                    size="sm"
                                    placeholder={locale.SearchAccounts || "Search accounts"}
                                    value={memberFilter}
                                    onValueChange={setMemberFilter}
                                />
                                <div className="max-h-64 overflow-auto border border-default-200 rounded-medium p-2 flex flex-col gap-1">
                                    {visibleAccounts.length === 0 && (
                                        <span className="text-sm text-default-400 p-2">
                                            {locale.NoAccounts || "No accounts"}
                                        </span>
                                    )}
                                    {visibleAccounts.map(a => (
                                        <label
                                            key={a.id}
                                            className="flex flex-row items-center gap-2 px-2 py-1 rounded hover:bg-default-100 cursor-pointer"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={memberIds.has(a.id)}
                                                onChange={() => toggleMember(a.id)}
                                            />
                                            <span className="text-sm">{a.name}</span>
                                            <span className="text-xs text-default-400">{a.email}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="light" onPress={onOpenChange}>{locale.Cancel || "Cancel"}</Button>
                        <Button color="primary" isLoading={saving} onPress={handleSave}>
                            {locale.Save || "Save"}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            <Modal isOpen={deleteDisclosure.isOpen} onOpenChange={deleteDisclosure.onOpenChange}>
                <ModalContent>
                    <ModalHeader>{locale.Delete || "Delete"}</ModalHeader>
                    <ModalBody>
                        <span>
                            {locale.DeleteConfirm || "Delete this group? Accounts stay, only the grouping is removed."}
                        </span>
                        {deleteTarget && <span className="font-medium">{deleteTarget.name}</span>}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="light" onPress={deleteDisclosure.onClose}>
                            {locale.Cancel || "Cancel"}
                        </Button>
                        <Button color="danger" onPress={handleDelete}>{locale.Delete || "Delete"}</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}
