import { Header } from "../../components/header/Header";
import { useEffect, useState } from "react";
import { settingsApi } from "../../api/instance";
import { SettingsEntry } from "../../../shared/modules/settings/settings.interface";
import { Locale } from "../../methods/locale";
import { Button, Input } from "@heroui/react";

const FIELD_LABELS: Record<string, string> = {
    tg_bot_api_base_url: "Telegram Bot API URL",
    tg_user_id: "Support Telegram ID",
    nowpayments_api_key: "NowPayments API Key",
    ipn_callback_url: "IPN Callback URL",
    resend_api_key: "Resend API Key",
    email_from: "Email From",
    allowed_register_domains: "Allowed Register Domains",
    client_url: "Client URL",
    enable_recharge: "Enable Recharge",
    daily_register_limit: "Daily Registration Limit",
    fallback_model_alias: "Fallback Model Alias",
    show_home_page: "Show Home Page",
    routing_timezone: "Routing Timezone",
    weekly_limit: "Weekly Spending Limit (CNY)",
    usd_cny_rate: "USD → CNY Rate (topup invoice & conversion)",
};

export default function SettingsPage() {
    const locale = Locale("Menu");
    const [entries, setEntries] = useState<SettingsEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState("");
    const [moneyCurrency, setMoneyCurrency] = useState("USD");
    const [converting, setConverting] = useState(false);
    const [convertMsg, setConvertMsg] = useState("");

    const fetchSettings = async () => {
        setLoading(true);
        const res = await settingsApi.list({});
        if (res.success && res.data) {
            setEntries(res.data.entries);
            setMoneyCurrency(res.data.money_currency || "USD");
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchSettings();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setMsg("");
        const res = await settingsApi.save({ entries });
        if (res.success) {
            setMsg("Saved!");
        } else {
            setMsg("Save failed");
        }
        setSaving(false);
    };

    const updateEntry = (key: string, value: string) => {
        setEntries(prev => prev.map(e => e.key === key ? { ...e, value } : e));
    };

    // Saves first: the conversion reads the rate from settings, so an edited
    // rate must be persisted before it can be the one applied.
    const handleConvert = async () => {
        setConverting(true);
        setConvertMsg("");
        const saved = await settingsApi.save({ entries });
        if (!saved.success) {
            setConvertMsg("Could not save the rate, nothing converted");
            setConverting(false);
            return;
        }
        const res = await settingsApi.migrateMoney({});
        if (!res.success) {
            setConvertMsg("Conversion failed");
        } else {
            // The rest of the app reads the symbol from the boot config; flip it
            // in place so the pages already rendered switch without a reload.
            if (window.__APP_CONFIG__) window.__APP_CONFIG__.money_currency = "CNY";
            setMoneyCurrency("CNY");
            setConvertMsg(res.data.migrated ? `Converted at ${res.data.rate} CNY per USD` : "Already in CNY, nothing changed");
        }
        setConverting(false);
    };

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={locale.Settings || "Settings"} />
            <div className="p-6 flex flex-col gap-4 flex-1 overflow-auto">
                {loading ? (
                    <div className="p-6">Loading...</div>
                ) : (
                    <>
                        <h1 className="text-xl font-bold">{locale.Settings || "Settings"}</h1>
                        <div className="flex flex-col gap-4 max-w-lg">
                            {entries.map(e => (
                                <div key={e.key} className="flex flex-col gap-1">
                                    <label className="text-sm font-medium text-gray-600">
                                        {FIELD_LABELS[e.key] || e.key}
                                    </label>
                                    <Input
                                        size="sm"
                                        value={e.value}
                                        onChange={ev => updateEntry(e.key, ev.target.value)}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center gap-4">
                            <Button size="sm" color="primary" isLoading={saving} onPress={handleSave}>
                                {locale.Save || "Save"}
                            </Button>
                            {msg && (
                                <span className={msg === "Saved!" ? "text-green-600 text-sm" : "text-red-500 text-sm"}>
                                    {msg}
                                </span>
                            )}
                        </div>
                        <div className="border-t pt-4 max-w-lg flex flex-col gap-2">
                            <span className="text-sm font-medium text-gray-600">Currency Conversion</span>
                            <p className="text-xs text-gray-500">
                                Balances, model prices, usage and topup records are still stored in USD. Converting
                                multiplies them by the saved rate once and cannot be undone.
                            </p>
                            {moneyCurrency === "CNY" ? (
                                <span className="text-green-600 text-sm">Stored in CNY</span>
                            ) : (
                                <Button size="sm" color="warning" className="self-start" isLoading={converting} onPress={handleConvert}>
                                    Convert to CNY
                                </Button>
                            )}
                            {convertMsg && <span className="text-sm text-gray-600">{convertMsg}</span>}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
