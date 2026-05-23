import { useState, useEffect, useCallback } from "react";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input, Chip, Divider, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination } from "@heroui/react";
import { giftCardApi } from "../../../api/instance";
import { Locale } from "../../../methods/locale";
import { GiftCardDTO } from "../../../../shared/modules/gift_card/gift_card.interface";

export default function GiftCardManageModal({
    isOpen,
    onOpenChange,
}: {
    isOpen: boolean;
    onOpenChange: () => void;
}) {
    const t = Locale("AccountPage");
    const common = Locale("Common");

    const [cards, setCards] = useState<GiftCardDTO[]>([]);
    const [loading, setLoading] = useState(false);
    const [amount, setAmount] = useState("");
    const [creating, setCreating] = useState(false);
    const [newCardCode, setNewCardCode] = useState("");
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);
    const pageSize = 10;

    const fetchCards = useCallback(async () => {
        setLoading(true);
        try {
            const res = await giftCardApi.list({} as any);
            if (res.success && res.data) {
                setCards(res.data.list.sort((a, b) => b.create_time - a.create_time));
            }
        } catch { } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) fetchCards();
    }, [isOpen, fetchCards]);

    const handleCreate = async () => {
        const tokenAmount = Number(amount);
        if (isNaN(tokenAmount) || tokenAmount <= 0) return;
        setCreating(true);
        setError("");
        setNewCardCode("");
        try {
            const res = await giftCardApi.create({ token_amount: tokenAmount } as any);
            if (res.success && res.data?.card) {
                setNewCardCode(res.data.card.code);
                setAmount("");
                await fetchCards();
            } else {
                setError(res.message || "Create failed");
            }
        } catch (err: any) {
            setError(err.message || "Create failed");
        } finally {
            setCreating(false);
        }
    };

    const statusColor = (status: string) => {
        switch (status) {
            case "unused": return "success" as const;
            case "redeemed": return "default" as const;
            case "expired": return "danger" as const;
            default: return "default" as const;
        }
    };

    const statusLabel = (status: string) => {
        switch (status) {
            case "unused": return t.GiftCardStatusUnused;
            case "redeemed": return t.GiftCardStatusRedeemed;
            case "expired": return t.GiftCardStatusExpired;
            default: return status;
        }
    };

    const totalPages = Math.ceil(cards.length / pageSize);
    const pageCards = cards.slice((page - 1) * pageSize, page * pageSize);

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="2xl" placement="center">
            <ModalContent>
                <ModalHeader>{t.GiftCardManage}</ModalHeader>
                <ModalBody className="space-y-4">
                    {/* Create new card */}
                    <div className="flex items-end gap-3 p-3 rounded-lg bg-default-50">
                        <Input
                            label={t.GiftCardAmount}
                            placeholder={t.GiftCardAmountPlaceholder}
                            value={amount}
                            onValueChange={setAmount}
                            className="w-40"
                            size="sm"
                        />
                        <Button
                            color="warning"
                            size="sm"
                            onPress={handleCreate}
                            isLoading={creating}
                            isDisabled={!amount || isNaN(Number(amount)) || Number(amount) <= 0}
                        >
                            {t.GiftCardCreate}
                        </Button>
                    </div>

                    {newCardCode && (
                        <div className="p-3 rounded-lg bg-success-50 border border-success-200 text-sm">
                            <span className="font-medium">{t.GiftCardCreated} </span>
                            <code className="text-primary font-mono text-base select-all">{newCardCode}</code>
                        </div>
                    )}

                    {error && (
                        <p className="text-xs text-danger px-1">{error}</p>
                    )}

                    <Divider />

                    {/* Card list */}
                    {loading ? (
                        <p className="text-sm text-gray-500">{t.GiftCardLoading || "Loading..."}</p>
                    ) : cards.length === 0 ? (
                        <p className="text-sm text-gray-500">{t.GiftCardNoData}</p>
                    ) : (
                        <>
                            <Table aria-label="Gift cards" removeWrapper>
                                <TableHeader>
                                    <TableColumn className="text-xs">{t.GiftCardCode}</TableColumn>
                                    <TableColumn className="text-xs">{t.GiftCardAmountCol}</TableColumn>
                                    <TableColumn className="text-xs">{t.GiftCardStatus}</TableColumn>
                                    <TableColumn className="text-xs">{t.GiftCardRedeemedBy}</TableColumn>
                                    <TableColumn className="text-xs">{t.GiftCardCreatedAt}</TableColumn>
                                </TableHeader>
                                <TableBody>
                                    {pageCards.map(card => (
                                        <TableRow key={card.id}>
                                            <TableCell>
                                                <code className="text-xs font-mono">{card.code}</code>
                                            </TableCell>
                                            <TableCell>${card.token_amount}</TableCell>
                                            <TableCell>
                                                <Chip size="sm" color={statusColor(card.status)} variant="flat">
                                                    {statusLabel(card.status)}
                                                </Chip>
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {card.redeemed_by || "-"}
                                            </TableCell>
                                            <TableCell className="text-xs">
                                                {new Date(card.create_time).toLocaleDateString()}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            {totalPages > 1 && (
                                <div className="flex justify-center">
                                    <Pagination total={totalPages} page={page} onChange={setPage} size="sm" />
                                </div>
                            )}
                        </>
                    )}
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={() => onOpenChange()}>
                        {common.ButtonClose || "Close"}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    );
}
