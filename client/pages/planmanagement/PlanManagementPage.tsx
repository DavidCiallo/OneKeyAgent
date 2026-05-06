import { Header } from "../../components/header/Header";
import { useEffect, useState } from "react";
import { SubscriptionPlanDTO, SubscriptionPlanListRequest, SubscriptionPlanUpdateRequest, SubscriptionPlanUpdateBody } from "../../../shared/modules/subscription_plan/subscription_plan.interface";
import { SubscriptionPlanRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Button, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input } from "@heroui/react";

type EditForm = {
    name: string;
    monthly_limit: number;
    price: number;
    duration_days: number;
};

export default function PlanManagementPage() {
    const [list, setList] = useState<SubscriptionPlanDTO[]>([]);
    const locale = Locale("PlanManagementPage");
    const common = Locale("Common");

    const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose, onOpenChange: onFormOpenChange } = useDisclosure();
    const [editId, setEditId] = useState<string>("");
    const [form, setForm] = useState<EditForm>({ name: "", monthly_limit: 0, price: 0, duration_days: 0 });

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchList = async () => {
        const req = new SubscriptionPlanListRequest({ auth: getToken() });
        const res = await SubscriptionPlanRouter.list(req);
        if (res.success && res.data) {
            setList(res.data.list);
        }
    };

    useEffect(() => {
        fetchList();
    }, []);

    const openEdit = (item: SubscriptionPlanDTO) => {
        setEditId(item.id);
        setForm({ name: item.name, monthly_limit: item.monthly_limit, price: item.price, duration_days: item.duration_days });
        onFormOpen();
    };

    const handleEditConfirm = async () => {
        const updateData: Record<string, any> = {};
        if (form.name) updateData.name = form.name;
        updateData.monthly_limit = form.monthly_limit;
        updateData.price = form.price;
        updateData.duration_days = form.duration_days;

        const req = new SubscriptionPlanUpdateRequest({
            id: editId,
            plan: new SubscriptionPlanUpdateBody(updateData),
            auth: getToken(),
        });
        const res = await SubscriptionPlanRouter.update(req);
        if (res.success) {
            onFormClose();
            fetchList();
        }
    };

    const columns = [
        <TableColumn key="name">{locale.Name}</TableColumn>,
        <TableColumn key="monthly_limit">{locale.MonthlyLimit}</TableColumn>,
        <TableColumn key="price">{locale.Price}</TableColumn>,
        <TableColumn key="duration_days">{locale.DurationDays}</TableColumn>,
        <TableColumn key="actions" align="center">{locale.Actions}</TableColumn>,
    ];

    const rows = list.map(item => (
        <TableRow key={item.id}>
            <TableCell>{item.name}</TableCell>
            <TableCell>{item.monthly_limit.toLocaleString()}</TableCell>
            <TableCell>${(item.price / 100).toFixed(2)}</TableCell>
            <TableCell>{item.duration_days}</TableCell>
            <TableCell>
                <Button size="sm" variant="flat" color="primary" onPress={() => openEdit(item)}>
                    {locale.Edit}
                </Button>
            </TableCell>
        </TableRow>
    ));

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={locale.Title} />
            <div className="p-8 flex flex-col gap-4 flex-1 overflow-hidden">
                <Table aria-label="Plan list" className="flex-1 overflow-auto">
                    <TableHeader>{columns}</TableHeader>
                    <TableBody emptyContent={locale.NoData}>
                        {rows}
                    </TableBody>
                </Table>
            </div>

            <Modal isOpen={isFormOpen} onOpenChange={onFormOpenChange} size="lg">
                <ModalContent>
                    <ModalHeader>{locale.EditTitle}</ModalHeader>
                    <ModalBody>
                        <div className="flex flex-col gap-3">
                            <Input
                                label={locale.Name}
                                value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                isRequired
                            />
                            <Input
                                label={locale.MonthlyLimit}
                                type="number"
                                value={String(form.monthly_limit)}
                                onChange={e => setForm({ ...form, monthly_limit: Number(e.target.value) })}
                                isRequired
                            />
                            <Input
                                label={locale.Price}
                                type="number"
                                value={String(form.price)}
                                onChange={e => setForm({ ...form, price: Number(e.target.value) })}
                                isRequired
                            />
                            <Input
                                label={locale.DurationDays}
                                type="number"
                                value={String(form.duration_days)}
                                onChange={e => setForm({ ...form, duration_days: Number(e.target.value) })}
                                isRequired
                            />
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="flat" onPress={onFormClose}>{common.ButtonCancel}</Button>
                        <Button color="primary" onPress={handleEditConfirm}>{common.ButtonSave}</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}