import { Modal, ModalContent, ModalHeader, ModalBody } from "@heroui/react";
import { ModelDTO } from "../../../../shared/modules/model/model.entity";
import { Locale } from "../../../methods/locale";
import { useEffect, useState, useCallback } from "react";
import { UsageRouter } from "../../../api/instance";
import { UsageStatsPeriod, UsageStatsRequest } from "../../../../shared/modules/usage/usage.interface";
import { UsageChart } from "../../../pages/usage/components/UsageChart";

type Props = {
    isOpen: boolean;
    onOpenChange: () => void;
    model: ModelDTO | null;
};

export function ModelUsageCard({ isOpen, onOpenChange, model }: Props) {
    const locale = Locale("ModelPage");
    const [stats, setStats] = useState<{
        today: UsageStatsPeriod;
        last24h: UsageStatsPeriod;
        last7Days: UsageStatsPeriod;
    } | null>(null);

    const getToken = () => localStorage.getItem("access_token") || "";

    const fetchStats = useCallback(async () => {
        if (!model) return;
        const req = new UsageStatsRequest({ modelId: model.id, auth: getToken() });
        const res = await UsageRouter.stats(req);
        if (res.success && res.data) {
            setStats(res.data);
        }
    }, [model]);

    useEffect(() => {
        if (isOpen) {
            fetchStats();
        }
    }, [isOpen, fetchStats]);

    if (!model) return null;

    return (
        <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="5xl">
            <ModalContent>
                <ModalHeader>{locale.UsageCardTitle} — {model.baseURL}</ModalHeader>
                <ModalBody>
                    <div className="flex flex-col gap-4">
                        {stats ? (
                            <UsageChart
                                today={stats.today}
                                last24h={stats.last24h}
                                last7Days={stats.last7Days}
                            />
                        ) : (
                            <p className="text-gray-500 text-sm">{locale.UsageCardPlaceholder}</p>
                        )}
                    </div>
                </ModalBody>
            </ModalContent>
        </Modal>
    );
}
