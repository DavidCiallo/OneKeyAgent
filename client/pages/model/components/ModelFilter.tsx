import { Select, SelectItem, Input, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type Props = {
    filterTier: string;
    filterBaseURL: string;
    onTierChange: (v: string) => void;
    onBaseURLChange: (v: string) => void;
    onAdd: () => void;
};

export function ModelFilter({ filterTier, filterBaseURL, onTierChange, onBaseURLChange, onAdd }: Props) {
    const locale = Locale("ModelPage");
    const common = Locale("Common");

    return (
        <div className="px-4 flex flex-row gap-3 justify-between items-end flex-wrap">
            <div className="flex flex-row gap-2">
                <Select
                    label={locale.Tier}
                    placeholder={locale.TierPlaceholder}
                    selectedKeys={filterTier ? [filterTier] : []}
                    onChange={e => onTierChange(e.target.value)}
                    className="w-40"
                    size="sm"
                >
                    <SelectItem key="">不筛选</SelectItem>
                    <SelectItem key="1">1</SelectItem>
                    <SelectItem key="2">2</SelectItem>
                    <SelectItem key="3">3</SelectItem>
                    <SelectItem key="4">4</SelectItem>
                    <SelectItem key="5">5</SelectItem>
                </Select>
                <Input
                    label={locale.BaseURL}
                    placeholder={locale.BaseURLPlaceholder}
                    value={filterBaseURL}
                    onChange={e => onBaseURLChange(e.target.value)}
                    className="w-64"
                    size="sm"
                />
            </div>
            <Button color="primary" size="sm" onPress={onAdd}>
                {common.ButtonAdd}
            </Button>
        </div>
    );
}