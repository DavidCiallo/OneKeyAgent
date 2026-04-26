import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback } from "react";
import { AccountRouter, AiRouter, UsageRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { AccountProfileRequest, AccountRegenerateRequest } from "../../../shared/modules/account/account.interface";
import { ModelsRequest } from "../../../shared/modules/ai/ai.interface";
import { MyUsageRequest } from "../../../shared/modules/usage/usage.interface";
import { Button, Card, CardBody, CardHeader, Divider, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from "@heroui/react";
import { AccountDTO } from "../../../shared/modules/account/account.interface";

export default function ProfilePage() {
    const locale = Locale("ProfilePage");
    const menuLocale = Locale("Menu");
    const getToken = () => localStorage.getItem("access_token") || "";

    const [account, setAccount] = useState<AccountDTO | null>(null);
    const [showApiKey, setShowApiKey] = useState(false);
    const [models, setModels] = useState<string[]>([]);
    const [regenerating, setRegenerating] = useState(false);
    const [usage, setUsage] = useState<{ today: number; thisWeek: number; total: number } | null>(null);
    const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose, onOpenChange: onConfirmChange } = useDisclosure();

    const fetchProfile = useCallback(async () => {
        const res = await AccountRouter.profile(new AccountProfileRequest({ auth: getToken() }));
        if (res.success && res.data?.account) {
            setAccount(res.data.account);
        }
    }, []);

    const fetchModels = useCallback(async () => {
        const res = await AiRouter.models(new ModelsRequest({ auth: getToken() }));
        if (res.success && res.data) {
            setModels(res.data.map((m: any) => m.id));
        }
    }, []);

    const fetchUsage = useCallback(async () => {
        const res = await UsageRouter.mystats(new MyUsageRequest({ auth: getToken() }));
        if (res.success && res.data) {
            setUsage(res.data);
        }
    }, []);

    useEffect(() => {
        fetchProfile();
        fetchModels();
        fetchUsage();
    }, [fetchProfile, fetchModels, fetchUsage]);

    const handleRegenerate = async () => {
        onConfirmClose();
        setRegenerating(true);
        try {
            const res = await AccountRouter.regenerate(new AccountRegenerateRequest({ auth: getToken() }));
            if (res.success && res.data) {
                await fetchProfile();
                setShowApiKey(true);
            }
        } finally {
            setRegenerating(false);
        }
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const maskedKey = (key: string) => {
        if (!key) return "—";
        if (showApiKey) return key;
        return key.slice(0, 8) + "******" + key.slice(-4);
    };

    const toM = (val: number) => (val / 1000).toFixed(1);

    const endpoint = `${window.location.origin}/api`;

    if (!account) return null;

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={menuLocale.Profile} />
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-2xl mx-auto space-y-6">
                    <Card>
                        <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.AccountInfo}</CardHeader>
                        <Divider />
                        <CardBody className="px-6 py-4">
                            <div className="flex flex-col md:flex-row gap-6">
                                <div className="space-y-4 flex-1">
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm text-gray-500 w-20">{locale.Name}</span>
                                        <span className="text-sm font-medium">{account.name}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm text-gray-500 w-20">{locale.Email}</span>
                                        <span className="text-sm font-medium">{account.email}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <span className="text-sm text-gray-500 w-20">{locale.Role}</span>
                                        <Chip size="sm" color={account.is_admin ? "warning" : "default"} variant="flat">
                                            {account.is_admin ? locale.Admin : locale.User}
                                        </Chip>
                                    </div>
                                </div>
                                {usage && (
                                    <div className="w-full md:w-56 space-y-3 md:pl-6">
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-gray-500">{locale.Today}</span>
                                                <span className="font-semibold text-primary">{toM(usage.today)}M</span>
                                            </div>
                                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min((usage.today / 100000) * 50, 100)}%` }} />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-gray-500">{locale.ThisWeek}</span>
                                                <span className="font-semibold text-success">{toM(usage.thisWeek)}M</span>
                                            </div>
                                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-success rounded-full transition-all" style={{ width: `${Math.min((usage.thisWeek / 100000) * 50, 100)}%` }} />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-xs mb-1">
                                                <span className="text-gray-500">{locale.Total}</span>
                                                <span className="font-semibold text-warning">{toM(usage.total)}M</span>
                                            </div>
                                            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                                <div className="h-full bg-warning rounded-full transition-all" style={{ width: `${Math.min((usage.total / Math.max(usage.total, 1)) * 100, 100)}%` }} />
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.ApiKeySection}</CardHeader>
                        <Divider />
                        <CardBody className="px-6 py-4 space-y-4">
                            <div className="flex items-center gap-2">
                                <code className="flex-1 text-sm bg-gray-100 px-4 py-2.5 rounded-lg font-mono break-all select-all">
                                    {maskedKey(account.apiKey)}
                                </code>
                                <Button size="sm" variant="flat" onPress={() => setShowApiKey(!showApiKey)}>
                                    {showApiKey ? locale.Hide : locale.Show}
                                </Button>
                                <Button size="sm" variant="flat" onPress={() => handleCopy(account.apiKey)}>
                                    {locale.Copy}
                                </Button>
                            </div>
                            <Button
                                color="danger"
                                variant="bordered"
                                size="sm"
                                className="font-bold"
                                onPress={onConfirmOpen}
                                isLoading={regenerating}
                            >
                                {locale.Regenerate}
                            </Button>
                        </CardBody>
                    </Card>

                    <Card>
                        <CardHeader className="px-6 py-4 font-semibold text-lg">{locale.EndpointSection}</CardHeader>
                        <Divider />
                        <CardBody className="px-6 py-4 space-y-4">
                            <div>
                                <span className="text-sm text-gray-500 block mb-2">{locale.Endpoint}</span>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 text-sm bg-gray-100 px-4 py-2.5 rounded-lg font-mono break-all select-all">
                                        {endpoint}
                                    </code>
                                    <Button size="sm" variant="flat" onPress={() => handleCopy(endpoint)}>
                                        {locale.Copy}
                                    </Button>
                                </div>
                            </div>
                            <div className="flex flex-row gap-2 items-center">
                                <span className="text-sm text-gray-500 block">{locale.AvailableModels}</span>
                                {models.map((model, index) => (
                                    <Chip key={index} color="primary" variant="flat">{model}</Chip>
                                ))}
                            </div>

                        </CardBody>
                    </Card>
                </div>
            </div>

            <Modal isOpen={isConfirmOpen} onOpenChange={onConfirmChange}>
                <ModalContent>
                    {(onClose) => (
                        <>
                            <ModalHeader>{locale.Regenerate}</ModalHeader>
                            <ModalBody>
                                <p className="text-sm text-gray-600">{locale.RegenerateConfirm}</p>
                            </ModalBody>
                            <ModalFooter>
                                <Button size="sm" variant="flat" onPress={onClose}>{locale.Cancel}</Button>
                                <Button size="sm" color="danger" onPress={handleRegenerate} isLoading={regenerating}>
                                    {locale.Regenerate}
                                </Button>
                            </ModalFooter>
                        </>
                    )}
                </ModalContent>
            </Modal>
        </div>
    );
}