import { Select, SelectItem, Button, Checkbox } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type Props = {
    filterModelAlias: string;
    onModelAliasChange: (v: string) => void;
    onAdd: () => void;
    modelAliasOptions: string[];
    selectedCount: number;
    allSelected: boolean;
    onToggleSelectAll: () => void;
    onBatchEnable: () => void;
    onBatchDisable: () => void;
    onBatchThinkingOn: () => void;
    onBatchThinkingOff: () => void;
    onBatchProxy: () => void;
    onClearSelection: () => void;
};

export function ProviderFilter({ filterModelAlias, onModelAliasChange, onAdd, modelAliasOptions, selectedCount, allSelected, onToggleSelectAll, onBatchEnable, onBatchDisable, onBatchThinkingOn, onBatchThinkingOff, onBatchProxy, onClearSelection }: Props) {
    const locale = Locale("ProviderPage");
    const common = Locale("Common");

    return (
        <div className="px-4 flex flex-row gap-3 justify-between items-end flex-wrap">
            <div className="flex flex-row gap-3 items-end">
                {/* No "no filter" entry: the page is organised per alias, so an
                    alias is always selected (the page lands on the first one). */}
                <Select
                    label={locale.ModelAlias}
                    placeholder={locale.ModelAliasPlaceholder}
                    selectedKeys={filterModelAlias ? [filterModelAlias] : []}
                    onChange={e => onModelAliasChange(e.target.value)}
                    className="w-60"
                    size="sm"
                    isDisabled={modelAliasOptions.length === 0}
                >
                    {modelAliasOptions.map((alias) => (
                        <SelectItem key={alias}>{alias}</SelectItem>
                    ))}
                </Select>
                <div className="flex flex-row items-center gap-1.5 pb-2">
                    <Checkbox
                        size="sm"
                        isSelected={allSelected}
                        onChange={onToggleSelectAll}
                        aria-label={locale.SelectAll}
                    />
                    <span className="text-xs text-default-500 whitespace-nowrap">{locale.SelectAll}</span>
                </div>
            </div>
            {selectedCount > 0 ? (
                <div className="flex items-center gap-2">
                    <span className="text-sm text-default-500 tabular-nums">{selectedCount} {locale.Selected}</span>
                    <Button size="sm" color="success" variant="flat" onPress={onBatchEnable}>
                        {locale.BatchEnable}
                    </Button>
                    <Button size="sm" color="warning" variant="flat" onPress={onBatchDisable}>
                        {locale.BatchDisable}
                    </Button>
                    <Button size="sm" color="secondary" variant="flat" onPress={onBatchThinkingOn}>
                        {locale.BatchThinkingOn}
                    </Button>
                    <Button size="sm" color="secondary" variant="flat" onPress={onBatchThinkingOff}>
                        {locale.BatchThinkingOff}
                    </Button>
                    <Button size="sm" color="primary" variant="flat" onPress={onBatchProxy}>
                        {locale.BatchSetProxy}
                    </Button>
                    <Button size="sm" variant="flat" onPress={onClearSelection}>
                        {locale.Clear}
                    </Button>
                </div>
            ) : (
                <Button color="primary" size="sm" onPress={onAdd}>
                    {common.ButtonAdd}
                </Button>
            )}
        </div>
    );
}
