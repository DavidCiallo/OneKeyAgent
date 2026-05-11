import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Button } from "@heroui/react";
import { AccountDTO } from "../../../../shared/modules/account/account.interface";
import { Locale } from "../../../methods/locale";
import { useAuth } from "../../../methods/auth-context";

type Props = {
    list: AccountDTO[];
    onEdit: (item: AccountDTO) => void;
    onDelete: (id: string) => void;
};

const formatBalance = (dollars?: number) => {
    if (dollars == null) return "$0.00";
    return "$" + dollars.toFixed(2);
};

const columns = (locale: Record<string, string>, is_admin: boolean) => {
    const cols = [
        <TableColumn key="name">{locale.Name}</TableColumn>,
        <TableColumn key="email">{locale.Email}</TableColumn>,
        <TableColumn key="balance">Balance</TableColumn>,
        <TableColumn key="is_admin" align="center">{locale.IsAdmin}</TableColumn>,
        <TableColumn key="apiKey" align="center">{locale.ApiKey}</TableColumn>,
    ];
    if (is_admin) {
        cols.push(<TableColumn key="actions" align="center">{locale.Actions}</TableColumn>);
    }
    return cols;
};

const rows = (list: AccountDTO[], locale: Record<string, string>, is_admin: boolean, onEdit: (item: AccountDTO) => void, onDelete: (id: string) => void) =>
    list.map(item => {
        const cells = [
            <TableCell key="name">{item.name}</TableCell>,
            <TableCell key="email">{item.email}</TableCell>,
            <TableCell key="balance">{formatBalance(item.balance)}</TableCell>,
            <TableCell key="is_admin">{item.is_admin ? locale.IsAdmin : locale.User}</TableCell>,
            <TableCell key="apiKey">{item.apiKey}</TableCell>,
        ];
        if (is_admin) {
            cells.push(
                <TableCell key="actions">
                    <div className="flex flex-row gap-2 justify-center">
                        <Button size="sm" variant="flat" onPress={() => onEdit(item)}>
                            {locale.Edit}
                        </Button>
                        <Button size="sm" variant="flat" color="danger" onPress={() => onDelete(item.id)}>
                            {locale.Delete}
                        </Button>
                    </div>
                </TableCell>
            );
        }
        return <TableRow key={item.id}>{cells}</TableRow>;
    });

export function AccountTable({ list, onEdit, onDelete }: Props) {
    const locale = Locale("AccountPage");
    const { is_admin } = useAuth();

    return (
        <Table aria-label="Account list" className="flex-1 overflow-auto">
            <TableHeader>{columns(locale, is_admin)}</TableHeader>
            <TableBody emptyContent={locale.NoData}>
                {rows(list, locale, is_admin, onEdit, onDelete)}
            </TableBody>
        </Table>
    );
}