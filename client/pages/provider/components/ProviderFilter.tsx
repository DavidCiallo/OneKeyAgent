import { Select, SelectItem, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";

type Props = {
    filterModelAlias: string;
    onModelAliasChange: (v: string) => void;
    onAdd: () => void;
    modelAliasOptions: string[];
    selectedCount: number;
    onBatchEnable: () => void;
    onBatchDisable: () => void;
    onBatchThinkingOn: () => void;
    onBatchThinkingOff: () => void;
    onBatchProxy: () => void;
    onClearSelection: () => void;
};

export function ProviderFilter({ filterModelAlias, onModelAliasChange, onAdd, modelAliasOptions, selectedCount, onBatchEnable, onBatchDisable, onBatchThinkingOn, onBatchThinkingOff, onBatchProxy, onClearSelection }: Props) {
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
                    className="w-60"
                    size="sm"
                >
                    <SelectItem key="">{locale.NoFilter}</SelectItem>
                    {modelAliasOptions.map((alias) => (
                        <SelectItem key={alias}>{alias}</SelectItem>
                    ))}
                </Select>
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
