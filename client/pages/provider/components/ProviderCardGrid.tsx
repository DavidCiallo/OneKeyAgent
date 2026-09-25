import { Button, Chip, Checkbox, Tooltip } from "@heroui/react";
import type { ReactNode } from "react";
import { ProviderDTO } from "../../../../shared/modules/provider/provider.interface";
import { Locale } from "../../../methods/locale";

type Props = {
    list: ProviderDTO[];
    onEdit: (item: ProviderDTO) => void;
    onCopy: (item: ProviderDTO) => void;
    onDelete: (id: string) => void;
    onMoveUp: (item: ProviderDTO) => void;
    onMoveDown: (item: ProviderDTO) => void;
    selectedIds: Set<string>;
    onToggleSelect: (id: string) => void;
};

// Mask a secret: enough to tell two keys apart, never enough to read one.
function maskSecret(value?: string) {
    if (!value) return "—";
    if (value.length <= 16) return value.slice(0, 2) + "…" + value.slice(-2);
    return value.slice(0, 8) + "…" + value.slice(-8);
}

// 131072 -> "128K"
function humanCount(n?: number) {
    if (!n || n <= 0) return null;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`;
    return String(n);
}

// Label plus a value that shrinks. min-w-0 lets the value go below its content
// width inside the flex row.
function Field({ label, value, mono, grow }: { label: string; value: string; mono?: boolean; grow?: boolean }) {
    return (
        <div className={`flex items-baseline gap-1.5 text-xs min-w-0 ${grow ? "flex-1" : ""}`}>
            <span className="text-default-400 shrink-0">{label}</span>
            <span className={`truncate min-w-0 ${mono ? "font-mono" : ""}`} title={value}>
                {value}
            </span>
        </div>
    );
}

// Off flags stay visible but dimmed, so "not supported" is still information.
function Flag({ label, on }: { label: string; on?: number }) {
    return (
        <Chip
            size="sm"
            variant={on ? "flat" : "bordered"}
            color={on ? "secondary" : "default"}
            className={`shrink-0 ${on ? "" : "opacity-50"}`}
        >
            {label}
        </Chip>
    );
}

function ArrowButton({ up, label, onPress }: { up: boolean; label: string; onPress: () => void }) {
    return (
        <button className="text-default-400 hover:text-default-700 p-0.5" onClick={onPress} aria-label={label} title={label}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {up ? <path d="M18 15l-6-6-6 6" /> : <path d="M6 9l6 6 6-6" />}
            </svg>
        </button>
    );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-default-400">{label}</span>
            {children}
        </div>
    );
}

// Routing state. A parked provider is silently skipped, so the reason has to be
// visible on the card.
function HealthChip({ item, locale }: { item: ProviderDTO; locale: any }) {
    const now = Date.now();
    const parkedMs = (item.cooldown_until || 0) - now;
    const quotaSpent = !!item.daily_quota && (item.today_count || 0) >= item.daily_quota;

    if (parkedMs > 0) {
        const mins = Math.ceil(parkedMs / 60000);
        return (
            <Tooltip content={`${item.failures || 0} consecutive failures`}>
                <Chip size="sm" variant="flat" color="danger" className="shrink-0">
                    {locale.Parked} {mins}m
                </Chip>
            </Tooltip>
        );
    }
    if (quotaSpent) {
        return (
            <Tooltip content={`${item.today_count}/${item.daily_quota}`}>
                <Chip size="sm" variant="flat" color="warning" className="shrink-0">
                    {locale.QuotaSpent}
                </Chip>
            </Tooltip>
        );
    }
    // Show a streak before it trips the cooldown.
    if ((item.failures || 0) > 0) {
        return (
            <Tooltip content={locale.FailStreakHint}>
                <Chip size="sm" variant="flat" color="warning" className="shrink-0">
                    ✕{item.failures}
                </Chip>
            </Tooltip>
        );
    }
    return null;
}

export function ProviderCardGrid({ list, onEdit, onCopy, onDelete, onMoveUp, onMoveDown, selectedIds, onToggleSelect }: Props) {
    const locale = Locale("ProviderPage");

    if (list.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                {locale.NoData}
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto px-1">
            {/* One provider per row, full width. */}
            <div className="flex flex-col gap-2">
                {list.map(item => (
                    <div
                        key={item.id}
                        className="bg-content1 rounded-xl shadow-sm border border-default-100 px-3 py-2 flex flex-col gap-1.5 hover:shadow-md transition-shadow"
                    >
                        {/* Line 1: identity, endpoint, credentials, actions.
                            Only the actions are shrink-0, so they stay on screen. */}
                        <div className="flex items-center gap-3 min-w-0">
                            <Checkbox
                                size="sm"
                                isSelected={selectedIds.has(item.id)}
                                onChange={() => onToggleSelect(item.id)}
                                aria-label={`Select ${item.name}`}
                                className="shrink-0"
                            />

                            <div className="flex items-center gap-2 min-w-0 shrink basis-44">
                                <span className="font-semibold text-sm truncate" title={item.name}>
                                    {item.name}
                                </span>
                                <Chip size="sm" variant="flat" className="shrink-0 font-mono">
                                    P{item.priority}
                                </Chip>
                                <Chip
                                    size="sm"
                                    variant="flat"
                                    color={item.enabled ? "success" : "default"}
                                    className="shrink-0"
                                >
                                    {item.enabled ? locale.StatusOn : locale.StatusOff}
                                </Chip>
                            </div>

                            <div className="flex flex-row gap-4 min-w-0 shrink grow basis-64">
                                <Field label={locale.Model} value={item.model || "—"} mono />
                                <Field label={locale.BaseURL} value={item.base_url || "—"} mono grow />
                            </div>

                            {/* Credentials give way first. */}
                            <div className="flex flex-row gap-4 min-w-0 shrink basis-56">
                                <Field label={locale.ApiKey} value={maskSecret(item.api_key)} mono />
                                <Field
                                    label={locale.ProxyURL}
                                    value={item.proxy_url ? maskSecret(item.proxy_url) : "—"}
                                    mono
                                />
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                                <ArrowButton up label={locale.Priority} onPress={() => onMoveUp(item)} />
                                <ArrowButton up={false} label={locale.Priority} onPress={() => onMoveDown(item)} />
                                <Button size="sm" variant="flat" className="min-w-0 px-2" onPress={() => onCopy(item)}>
                                    {locale.Copy}
                                </Button>
                                <Button size="sm" variant="flat" className="min-w-0 px-2" onPress={() => onEdit(item)}>
                                    {locale.Edit}
                                </Button>
                                <Button size="sm" variant="flat" color="danger" className="min-w-0 px-2" onPress={() => onDelete(item.id)}>
                                    {locale.Delete}
                                </Button>
                            </div>
                        </div>

                        {/* Line 2: protocol, capabilities, routing state */}
                        <div className="flex flex-wrap items-center gap-1 pl-8">
                            <Cell label={locale.AuthType}>
                                <span className="text-xs">{item.auth_type || "bearer"}</span>
                            </Cell>
                            <span className="text-default-200">·</span>
                            <Cell label={locale.ApiType}>
                                <span className="text-xs">{item.api_type || "openai"}</span>
                            </Cell>
                            <span className="text-default-200 mx-1">|</span>
                            <Flag label={locale.SupportsThinking} on={item.supports_thinking} />
                            <Flag label={locale.SupportsReasoningEffort} on={item.supports_reasoning_effort} />
                            <Flag label={locale.ReplayReasoning} on={item.replay_reasoning} />
                            <Flag label={locale.Search} on={item.enable_search} />

                            <span className="text-default-200 mx-1">|</span>
                            <HealthChip item={item} locale={locale} />
                            {item.max_context ? (
                                <Chip size="sm" variant="bordered" className="shrink-0">
                                    {locale.Context} {humanCount(item.max_context)}
                                </Chip>
                            ) : null}
                            {item.daily_quota ? (
                                <Chip size="sm" variant="bordered" className="shrink-0">
                                    {locale.Quota} {item.today_count || 0}/{humanCount(item.daily_quota)}
                                </Chip>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
