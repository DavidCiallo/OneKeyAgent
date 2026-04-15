import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Button, Chip } from "@heroui/react";
import { AccountDTO } from "../../../../shared/modules/account/account.interface";
import { Locale } from "../../../methods/locale";
import { isAdmin } from "../../../methods/auth";

type Props = {
    list: AccountDTO[];
    onEdit: (item: AccountDTO) => void;
    onDelete: (id: string) => void;
};

export function AccountTable({ list, onEdit, onDelete }: Props) {
    const locale = Locale("AccountPage");
    const admin = isAdmin();

    return (
        <Table aria-label="Account list" className="flex-1 overflow-auto">
            <TableHeader>
                <TableColumn>{locale.Name}</TableColumn>
                <TableColumn>{locale.Email}</TableColumn>
                <TableColumn align="center">{locale.IsAdmin}</TableColumn>
                {admin && <TableColumn>{locale.Actions}</TableColumn>}
            </TableHeader>
            <TableBody emptyContent={locale.NoData}>
                {list.map(item => (
                    <TableRow key={item.id}>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>{item.email}</TableCell>
                        <TableCell>
                            <Chip color={item.is_admin ? "primary" : "default"} size="sm">
                                {item.is_admin ? locale.IsAdmin : "User"}
                            </Chip>
                        </TableCell>
                        {admin && (
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
                        )}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}