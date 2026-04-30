import { Select, SelectItem, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type Props = {
    filterModelAlias: string;
    onModelAliasChange: (v: string) => void;
    onAdd: () => void;
};

export function ProviderFilter({ filterModelAlias, onModelAliasChange, onAdd }: Props) {
    const locale = Locale("ProviderPage");
    const common = Locale("Common");

    return (
        <div className="px-4 flex flex-row gap-3 justify-between items-end flex-wrap">
            <div className="flex flex-row gap-2">
                <Select
                    label={locale.ModelAlias}
                    placeholder={locale.ModelAliasPlaceholder}
                    selectedKeys={filterModelAlias ? [filterModelAlias] : []}
                    onChange={e => onModelAliasChange(e.target.value)}
                    className="w-40"
                    size="sm"
                >
                    <SelectItem key="">不筛选</SelectItem>
                </Select>
            </div>
            <Button color="primary" size="sm" onPress={onAdd}>
                {common.ButtonAdd}
            </Button>
        </div>
    );
}
