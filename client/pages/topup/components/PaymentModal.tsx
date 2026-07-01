import { useState } from "react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from "@heroui/react";
import { Locale } from "../../../methods/locale";
import { PAYMENT_CURRENCIES } from "../../../../shared/modules/subscription_record/subscription_record.interface";
import { PAYMENT_ICON_MAP } from "../../../images/svg/PaymentIcons";

export default function PaymentModal({
    isOpen,
    onOpenChange,
    planPrice,
    onProceedToPay,
    paying,
}: {
    isOpen: boolean;
    onOpenChange: () => void;
    planPrice: number;
    onProceedToPay: (payCurrency: string) => void;
    paying: boolean;
}) {
    const locale = Locale("TopupPage");
    const [selectedCurrency, setSelectedCurrency] = useState<string>(PAYMENT_CURRENCIES[0].pay_currency);

    const formatPrice = (dollars: number) => "$" + dollars.toFixed(2);

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
            <ModalContent>
                <ModalHeader>{locale.Payment}</ModalHeader>
                <ModalBody className="space-y-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                        <p className="text-sm text-gray-600">
                            <span className="text-base">{locale.DepositAmount}: </span>
                            <span className="text-primary text-base font-bold">{formatPrice(planPrice)}</span>
                            <span className="mx-1 text-base">USD</span>
                        </p>
                    </div>

                    <p className="text-sm font-medium text-gray-700">{locale.SelectCurrency}</p>

                    <div className="grid grid-cols-3 gap-2">
                        {PAYMENT_CURRENCIES.map((c) => {
                            const IconComponent = PAYMENT_ICON_MAP[c.iconKey];
                            const isSelected = selectedCurrency === c.pay_currency;
                            return (
                                <button
                                    key={c.pay_currency}
                                    type="button"
                                    onClick={() => setSelectedCurrency(c.pay_currency)}
                                    className={`
                                        flex items-center gap-2 rounded-xl border-2 p-2.5 transition-all
                                        ${isSelected
                                            ? "border-primary bg-primary/5 shadow-sm"
                                            : "border-gray-200 bg-white hover:border-gray-300"
                                        }
                                    `}
                                >
                                    {IconComponent && <IconComponent className="w-6 h-6 shrink-0" />}
                                    <div className="text-left leading-tight">
                                        <p className={`text-xs font-medium ${isSelected ? "text-primary" : "text-gray-900"}`}>
                                            {c.token}
                                        </p>
                                        <p className="text-[10px] text-gray-400">{c.chain}</p>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <Button
                        color="primary"
                        size="lg"
                        className="w-full"
                        onPress={() => onProceedToPay(selectedCurrency)}
                        isLoading={paying}
                    >
                        {locale.ProceedToPay}
                    </Button>
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={() => onOpenChange()}>
                        {Locale("Common").ButtonCancel || "取消"}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
