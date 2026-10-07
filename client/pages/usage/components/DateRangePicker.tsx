import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/react";
import {
    StatsDate,
    statsToday,
    statsDateAdd,
    statsDateStart,
    statsDateEndExclusive,
    statsDaySpan,
    formatStatsDate,
    parseStatsDate,
} from "../../../methods/timezone";

/**
 * A calendar range picker over `yyyymmdd` dates on the stats clock.
 *
 * Replaces the old Today/24h/3d/7d/30d preset row. A preset can only express
 * "the last N days from now", which cannot ask for a single past day or a range
 * that ended yesterday; those are the questions an operator actually has when
 * reconciling a bill.
 *
 * Interaction model, which is what a range picker has to get right:
 *
 *  - Clicking a day sets the *pending* end. The value is not reported until
 *    both ends exist, so a range is never half-updated mid-selection.
 *  - The first click sets the start and arms the end; the second sets the end
 *    and commits. Hovering in between previews the range that click would make.
 *  - Clicking a start that lands after the current end swaps them rather than
 *    producing an inverted range.
 *  - The text field is only committed on Enter or blur. Committing on every
 *    keystroke would fire a query per character.
 */

/** The half-open [start, end) millisecond window a date pair covers. */
export function rangeToMs(from: StatsDate, to: StatsDate): { since: number; until: number } {
    return { since: statsDateStart(from), until: statsDateEndExclusive(to) };
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** The calendar grid for a month: whole weeks, Monday-first. */
function monthGrid(year: number, month: number): (StatsDate | null)[] {
    const first = new Date(Date.UTC(year, month - 1, 1));
    // getUTCDay: 0=Sun. Shift so Monday is column 0.
    const lead = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells: (StatsDate | null)[] = [];
    for (let i = 0; i < lead; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
        cells.push(`${year}${String(month).padStart(2, "0")}${String(d).padStart(2, "0")}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function monthKey(d: StatsDate): { year: number; month: number } | null {
    const p = parseStatsDate(d);
    return p ? { year: p.year, month: p.month } : null;
}

export function DateRangePicker({ from, to, onChange, locale }: {
    from: StatsDate;
    to: StatsDate;
    onChange: (from: StatsDate, to: StatsDate) => void;
    locale?: Record<string, string>;
}) {
    const today = useMemo(() => statsToday(), []);
    const [open, setOpen] = useState(false);
    const [text, setText] = useState(`${from}-${to}`);
    const [invalid, setInvalid] = useState(false);
    const [focused, setFocused] = useState(false);

    // The month on screen. Follows the committed range when the panel opens,
    // and otherwise only changes when the user pages.
    const [view, setView] = useState(() => monthKey(from) ?? monthKey(today)!);

    // The in-progress selection. `pendingStart` is set by the first click;
    // the value is reported only once both ends exist.
    const [pendingStart, setPendingStart] = useState<StatsDate | null>(null);
    const [hover, setHover] = useState<StatsDate | null>(null);

    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Show the committed value whenever the field is not being edited.
    useEffect(() => {
        if (!focused) {
            setText(`${from}-${to}`);
            setInvalid(false);
        }
    }, [from, to, focused]);

    // Reopening starts from the committed range rather than whatever month the
    // last interaction happened to leave on screen.
    useEffect(() => {
        if (open) {
            setPendingStart(null);
            setHover(null);
            const m = monthKey(from);
            if (m) setView(m);
        }
    }, [open, from]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
                setPendingStart(null);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
                setPendingStart(null);
                // Only revert the field; the committed range is unchanged.
                if (inputRef.current === document.activeElement) inputRef.current?.blur();
                setText(`${from}-${to}`);
                setInvalid(false);
            }
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open, from, to]);

    const commitText = (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed) {
            setText(`${from}-${to}`);
            setInvalid(false);
            return;
        }
        const m = /^(\d{8})\s*-\s*(\d{8})$/.exec(trimmed);
        const single = parseStatsDate(trimmed) ? trimmed : null;
        const a = m ? m[1] : single;
        const b = m ? m[2] : single;
        if (!a || !b || !parseStatsDate(a) || !parseStatsDate(b)) {
            setInvalid(true);
            return;
        }
        // Accept the pair either way round rather than rejecting it.
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setInvalid(false);
        setText(`${lo}-${hi}`);
        if (lo !== from || hi !== to) onChange(lo, hi);
    };

    const pick = (date: StatsDate) => {
        if (pendingStart === null) {
            // First click: this is the start. The end is armed, not set.
            setPendingStart(date);
            setHover(date);
            return;
        }
        // Second click: order the two ends by value, so picking backwards
        // yields the same range as picking forwards.
        const [lo, hi] = date < pendingStart ? [date, pendingStart] : [pendingStart, date];
        setPendingStart(null);
        setHover(null);
        setOpen(false);
        setText(`${lo}-${hi}`);
        setInvalid(false);
        onChange(lo, hi);
    };

    // The range the grid should highlight: the pending preview while a second
    // end is being chosen, otherwise the committed range.
    const previewEnd = pendingStart !== null ? (hover ?? pendingStart) : to;
    const previewStart = pendingStart !== null ? pendingStart : from;
    const [rangeLo, rangeHi] = previewStart <= previewEnd
        ? [previewStart, previewEnd]
        : [previewEnd, previewStart];

    const inRange = (d: StatsDate) => d >= rangeLo && d <= rangeHi;
    const isEnd = (d: StatsDate) => d === rangeLo || d === rangeHi;

    const cells = monthGrid(view.year, view.month);
    const prev = addMonths(view.year, view.month, -1);
    const next = addMonths(view.year, view.month, 1);
    const span = statsDaySpan(rangeLo, rangeHi);

    const selectRange = (a: StatsDate, b: StatsDate) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        onChange(lo, hi);
        setPendingStart(null);
        setHover(null);
        setText(`${lo}-${hi}`);
        setInvalid(false);
        const m = monthKey(lo);
        if (m) setView(m);
    };

    /** The range currently on screen, for the panel's header and footer. */
    const shownLabel = rangeLo === rangeHi
        ? formatStatsDate(rangeLo)
        : `${formatStatsDate(rangeLo)} → ${formatStatsDate(rangeHi)}`;

    return (
        <div className="relative" ref={rootRef}>
            <div className="flex items-center gap-1">
                <div
                    className={`flex items-center gap-2 h-8 px-3 rounded-medium border transition-colors
                        ${invalid ? "border-danger" : focused || open ? "border-primary" : "border-default-200 hover:border-default-400"}
                        bg-default-100 dark:bg-default-50`}
                >
                    <button
                        type="button"
                        // A bare 14px glyph is a hard target to hit; pad it out to
                        // a real button while keeping the icon visually the same.
                        className="shrink-0 -ml-1 p-1 rounded-small text-default-500 hover:text-default-700 hover:bg-default-200/60 transition-colors"
                        aria-label={locale?.DateRange || "Date range"}
                        aria-expanded={open}
                        // Open eagerly and only ever close, rather than toggling.
                        // The field's focus handler also opens the panel, so a
                        // toggle here races it: focus opens, the toggle closes,
                        // and the panel appears to flash and vanish. Opening is
                        // also what the icon reads as doing.
                        // The document-level mousedown listener closes the panel
                        // for clicks outside the picker. Stopping propagation
                        // here keeps this click from being read as "outside":
                        // without it the panel is closed and reopened within the
                        // same gesture, which is what made it flash.
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onClick={() => {
                            if (open) {
                                setOpen(false);
                                setPendingStart(null);
                            } else {
                                setOpen(true);
                            }
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="4" width="18" height="18" rx="2" />
                            <path d="M16 2v4M8 2v4M3 10h18" />
                        </svg>
                    </button>
                    <input
                        ref={inputRef}
                        className="w-[13.5rem] bg-transparent outline-none text-small tabular-nums"
                        value={text}
                        spellCheck={false}
                        placeholder={`${today}-${today}`}
                        aria-label={locale?.DateRange || "Date range"}
                        onFocus={() => { setFocused(true); setOpen(true); }}
                        onBlur={() => { setFocused(false); commitText(text); }}
                        onChange={(e) => { setText(e.target.value); setInvalid(false); }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                commitText(text);
                                setOpen(false);
                                (e.target as HTMLInputElement).blur();
                            }
                            // Escape is handled by the document listener so the
                            // panel and the field revert together.
                        }}
                    />
                    <span className="text-tiny text-default-400 shrink-0 whitespace-nowrap">
                        {span > 0 ? (locale?.DayCount || "{n}d").replace("{n}", String(span)) : ""}
                    </span>
                </div>
                <Button
                    size="sm"
                    isIconOnly
                    variant="flat"
                    className="h-8 w-8 min-w-8"
                    aria-label={locale?.Today || "Today"}
                    onPress={() => {
                        const t = statsToday();
                        selectRange(t, t);
                        setOpen(false);
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                    </svg>
                </Button>
            </div>

            {open && (
                <div
                    data-date-range-panel
                    className="absolute z-50 mt-1 p-3 rounded-large border border-default-200 bg-content1 shadow-large w-[19.5rem]"
                >
                    <div className="flex items-center justify-between mb-2">
                        <Button size="sm" isIconOnly variant="light" className="w-7 h-7 min-w-7"
                            onPress={() => setView(prev)} aria-label="Previous month">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M15 18l-6-6 6-6" />
                            </svg>
                        </Button>
                        <div className="text-small font-medium tabular-nums">
                            {MONTH_NAMES[view.month - 1]} {view.year}
                        </div>
                        <Button size="sm" isIconOnly variant="light" className="w-7 h-7 min-w-7"
                            onPress={() => setView(next)} aria-label="Next month">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 18l6-6-6-6" />
                            </svg>
                        </Button>
                    </div>

                    {/* Which end the next click sets. Spelling it out is what
                        makes two-click selection predictable. */}
                    <div className="mb-2 text-tiny text-default-500">
                        {pendingStart === null
                            ? (locale?.PickStart || "Pick the start date")
                            : (locale?.PickEnd || "Pick the end date")}
                    </div>

                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {WEEKDAYS.map((w) => (
                            <div key={w} className="h-6 flex items-center justify-center text-tiny text-default-400">{w}</div>
                        ))}
                    </div>

                    <div className="grid grid-cols-7 gap-0.5" onMouseLeave={() => setHover(null)}>
                        {cells.map((d, i) => {
                            if (!d) return <div key={`x${i}`} className="h-7" />;
                            const end = isEnd(d);
                            const between = inRange(d) && !end;
                            const future = d > today;
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    className={`h-7 rounded-medium text-tiny tabular-nums transition-colors
                                        ${end
                                            ? "bg-primary text-primary-foreground font-semibold"
                                            : between
                                                ? "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200"
                                                : future
                                                    ? "text-default-300 hover:bg-default-100"
                                                    : "hover:bg-default-100"}
                                        ${d === today && !end ? "ring-1 ring-inset ring-primary-300" : ""}`}
                                    onMouseEnter={() => setHover(d)}
                                    onClick={() => pick(d)}
                                >
                                    {Number(d.slice(6, 8))}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-default-100">
                        <div className="flex gap-1">
                            {[
                                { label: locale?.Last7 || "7d", days: 6 },
                                { label: locale?.Last30 || "30d", days: 29 },
                            ].map((p) => (
                                <Button key={p.label} size="sm" variant="light" className="h-7 px-2 text-tiny"
                                    onPress={() => {
                                        const t = statsToday();
                                        selectRange(statsDateAdd(t, -p.days), t);
                                        setOpen(false);
                                    }}>
                                    {p.label}
                                </Button>
                            ))}
                            <Button size="sm" variant="light" className="h-7 px-2 text-tiny"
                                onPress={() => {
                                    const t = statsToday();
                                    selectRange(`${t.slice(0, 6)}01`, t);
                                    setOpen(false);
                                }}>
                                {locale?.MonthToDate || "MTD"}
                            </Button>
                        </div>
                        <span className="text-tiny text-default-400 tabular-nums">
                            {(locale?.DayCount || "{n}d").replace("{n}", String(span))}
                        </span>
                    </div>
                    <div className="mt-1 text-tiny text-default-400">{shownLabel}</div>
                </div>
            )}
        </div>
    );
}
