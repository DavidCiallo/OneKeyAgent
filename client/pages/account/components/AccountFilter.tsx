import { Input, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { isAdmin } from "../../../methods/auth";

type Props = {
    filterName: string;
    filterEmail: string;
    onNameChange: (v: string) => void;
    onEmailChange: (v: string) => void;
    onAdd: () => void;
};

export function AccountFilter({ filterName, filterEmail, onNameChange, onEmailChange, onAdd }: Props) {
    const locale = Locale("AccountPage");
    const common = Locale("Common");
    const admin = isAdmin();

    return (
        <div className="px-4 flex flex-row gap-3 justify-between items-end flex-wrap">
            <div className="flex flex-row gap-2">
                <Input
                    label={locale.Name}
                    placeholder={locale.NamePlaceholder}
                    value={filterName}
                    onChange={e => onNameChange(e.target.value)}
                    className="w-40"
                    size="sm"
                />
                <Input
                    label={locale.Email}
                    placeholder={locale.EmailPlaceholder}
                    value={filterEmail}
                    onChange={e => onEmailChange(e.target.value)}
                    className="w-64"
                    size="sm"
                />
            </div>
            {admin && (
                <Button color="primary" size="sm" onPress={onAdd}>
                    {common.ButtonAdd}
                </Button>
            )}
        </div>
    );
}