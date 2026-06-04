import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Switch } from "@heroui/react";
import { useEffect, useState } from "react";
import { Locale } from "../../../methods/locale";

type ModelForm = {
    alias?: string;
    input_price: number;
    cache_price: number;
    output_price: number;
    is_public?: number;
};

type Props = {
    isOpen: boolean;
    onOpenChange: () => void;
    mode: "create" | "edit";
    form: ModelForm;
    onFormChange: (f: ModelForm) => void;
    onConfirm: () => void;
};

export function ModelFormModal({ isOpen, onOpenChange, mode, form, onFormChange, onConfirm }: Props) {
    const locale = Locale("ModelPage");
    const common = Locale("Common");

    const [input_priceStr, setInputPriceStr] = useState(String(form.input_price));
    const [cache_priceStr, setCachePriceStr] = useState(String(form.cache_price));
    const [output_priceStr, setOutputPriceStr] = useState(String(form.output_price));

    // Sync from parent form when opening
    useEffect(() => {
        setInputPriceStr(String(form.input_price));
        setCachePriceStr(String(form.cache_price));
        setOutputPriceStr(String(form.output_price));
    }, [isOpen]);

    const commitPrices = () => {
        const ip = parseFloat(input_priceStr);
        const cp = parseFloat(cache_priceStr);
        const op = parseFloat(output_priceStr);
        if (!isNaN(ip) && !isNaN(cp) && !isNaN(op)) {
            onFormChange({ ...form, input_price: ip, cache_price: cp, output_price: op });
        }
    };

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
            <ModalContent>
                <ModalHeader>{mode === "create" ? locale.CreateTitle : locale.EditTitle}</ModalHeader>
                <ModalBody>
                    <div className="flex flex-col gap-3">
                        <Input
                            label={locale.Alias}
                            value={form.alias || ""}
                            onChange={e => onFormChange({ ...form, alias: e.target.value })}
                            isRequired
                        />
                        <Input
                            label={locale.InputPrice || "Input Price"}
                            value={input_priceStr}
                            onValueChange={setInputPriceStr}
                            onBlur={commitPrices}
                            startContent={<span className="text-default-400 text-sm font-mono">$</span>}
                            className="font-mono"
                        />
                        <Input
                            label={locale.CachePrice || "Cache Price"}
                            value={cache_priceStr}
                            onValueChange={setCachePriceStr}
                            onBlur={commitPrices}
                            startContent={<span className="text-default-400 text-sm font-mono">$</span>}
                            className="font-mono"
                            description={locale.CachePriceDesc || "0 = same as input price"}
                        />
                        <Input
                            label={locale.OutputPrice || "Output Price"}
                            value={output_priceStr}
                            onValueChange={setOutputPriceStr}
                            onBlur={commitPrices}
                            startContent={<span className="text-default-400 text-sm font-mono">$</span>}
                            className="font-mono"
                        />
                        <Switch
                            isSelected={form.is_public === 1}
                            onValueChange={v => onFormChange({ ...form, is_public: v ? 1 : 0 })}
                        >
                            {locale.Public}
                        </Switch>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={onOpenChange}>{common.ButtonCancel}</Button>
                    <Button color="primary" onPress={onConfirm}>{common.ButtonConfirm}</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
