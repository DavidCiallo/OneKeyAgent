import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Button } from "@heroui/react";
import { AccountDTO } from "../../../../shared/modules/account/account.interface";
import { Locale } from "../../../methods/locale";

type Props = {
    list: AccountDTO[];
    onEdit: (item: AccountDTO) => void;
    onDelete: (id: string) => void;
};

export function AccountTable({ list, onEdit, onDelete }: Props) {
    const locale = Locale("AccountPage");

    const roleLabel = (role: string) => {
        return role === "admin" ? locale.RoleAdmin : locale.RoleUser;
    };

    return (
        <Table aria-label="Account list" className="flex-1 overflow-auto">
            <TableHeader>
                <TableColumn>{locale.Name}</TableColumn>
                <TableColumn>{locale.Email}</TableColumn>
                <TableColumn align="center">{locale.Role}</TableColumn>
                <TableColumn>{locale.Actions}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={locale.NoData}>
                {list.map(item => (
                    <TableRow key={item.id}>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>{item.email}</TableCell>
                        <TableCell>{roleLabel(item.role)}</TableCell>
                        <TableCell>
                            <div className="flex flex-row gap-2">
                                <Button size="sm" variant="flat" onPress={() => onEdit(item)}>
                                    {locale.Edit}
                                </Button>
                                <Button size="sm" variant="flat" color="danger" onPress={() => onDelete(item.id)}>
                                    {locale.Delete}
                                </Button>
                            </div>
                        </TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}