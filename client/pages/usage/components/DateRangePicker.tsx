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
 * The input accepts the `yyyymmdd-yyyymmdd` form directly, and the calendar
 * underneath is the friendly path to the same value. Both are the same string,
 * so there is one source of truth rather than a text field that can disagree
 * with a calendar selection.
 */

/** The half-open [start, end) millisecond window a date pair covers. */
export function rangeToMs(from: StatsDate, to: StatsDate): { since: number; until: number } {
    return { since: statsDateStart(from), until: statsDateEndExclusive(to) };
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** The calendar grid for a month: 6 rows x 7 cols, Monday-first. */
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

const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function DateRangePicker({ from, to, onChange, locale }: {
    from: StatsDate;
    to: StatsDate;
    onChange: (from: StatsDate, to: StatsDate) => void;
    locale?: Record<string, string>;
}) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState(`${from}-${to}`);
    const [editing, setEditing] = useState(false);
    const [invalid, setInvalid] = useState(false);
    // The month the calendar shows. Follows the range unless the user pages away.
    const today = useMemo(() => statsToday(), []);
    const [view, setView] = useState(() => {
        const p = parseStatsDate(from) ?? parseStatsDate(today)!;
        return { year: p.year, month: p.month };
    });
    // Which end the next calendar click sets. Clicking a fresh range restarts at
    // the start, so "click, click" reads as a range without any modifier keys.
    const [anchor, setAnchor] = useState<"from" | "to">("from");
    const [hover, setHover] = useState<StatsDate | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    // Keep the text field in step when the value changes from outside (a
    // calendar pick, or Clear), but never while the user is mid-edit.
    useEffect(() => {
        if (!editing) {
            setText(`${from}-${to}`);
            setInvalid(false);
        }
    }, [from, to, editing]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
                setEditing(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setOpen(false);
                setEditing(false);
                setText(`${from}-${to}`);
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
        const m = /^(\d{8})\s*-\s*(\d{8})$/.exec(trimmed) ?? (parseStatsDate(trimmed) ? [trimmed, trimmed, trimmed] : null);
        if (!m) {
            setInvalid(true);
            return;
        }
        const a = m[1], b = m[2] ?? m[1];
        if (!parseStatsDate(a) || !parseStatsDate(b)) {
            setInvalid(true);
            return;
        }
        // Accept the pair either way round rather than rejecting it.
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setInvalid(false);
        setText(`${lo}-${hi}`);
        onChange(lo, hi);
    };

    const pick = (date: StatsDate) => {
        if (anchor === "from") {
            // A second click before the start makes the clicked day the start.
            onChange(date, date > to ? date : to);
            setAnchor("to");
            return;
        }
        const [lo, hi] = date < from ? [date, from] : [from, date];
        onChange(lo, hi);
        setAnchor("from");
        setHover(null);
        setOpen(false);
        setEditing(false);
    };

    const cells = monthGrid(view.year, view.month);
    const prev = addMonths(view.year, view.month, -1);
    const next = addMonths(view.year, view.month, 1);

    const inRange = (d: StatsDate) => {
        // While the second end is being picked, preview the range the click
        // would produce so the shape is visible before committing to it.
        if (anchor === "to" && hover) {
            const [lo, hi] = hover < from ? [hover, from] : [from, hover];
            return d >= lo && d <= hi;
        }
        return d >= from && d <= to;
    };

    const span = statsDaySpan(from, to);
    const label = from === to
        ? formatStatsDate(from)
        : `${formatStatsDate(from)} → ${formatStatsDate(to)}`;

    return (
        <div className="relative" ref={rootRef}>
            <div className="flex items-center gap-1">
                <div
                    className={`flex items-center gap-2 h-8 px-3 rounded-medium border transition-colors cursor-pointer
                        ${invalid ? "border-danger" : "border-default-200 hover:border-default-400"}
                        bg-default-100 dark:bg-default-50`}
                    onClick={() => { setOpen((v) => !v); setEditing(true); }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-default-500 shrink-0">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <path d="M16 2v4M8 2v4M3 10h18" />
                    </svg>
                    <input
                        className="w-[13.5rem] bg-transparent outline-none text-small tabular-nums"
                        value={text}
                        spellCheck={false}
                        placeholder={`${today}-${today}`}
                        aria-label={locale?.DateRange || "Date range"}
                        onFocus={() => { setEditing(true); setOpen(true); }}
                        onChange={(e) => { setText(e.target.value); setInvalid(false); }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") { commitText(text); setOpen(false); setEditing(false); (e.target as HTMLInputElement).blur(); }
                            if (e.key === "Escape") { setText(`${from}-${to}`); setInvalid(false); setOpen(false); setEditing(false); }
                        }}
                        onBlur={() => { commitText(text); setEditing(false); }}
                    />
                    {span > 0 && (
                        <span className="text-tiny text-default-400 shrink-0 whitespace-nowrap">
                            {(locale?.DayCount || "{n}d").replace("{n}", String(span))}
                        </span>
                    )}
                </div>
                <Button
                    size="sm"
                    isIconOnly
                    variant="flat"
                    className="h-8 w-8 min-w-8"
                    aria-label={locale?.Today || "Today"}
                    onPress={() => {
                        const t = statsToday();
                        onChange(t, t);
                        setView(parseStatsDate(t)!);
                        setAnchor("from");
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                    </svg>
                </Button>
            </div>

            {open && (
                <div className="absolute z-50 mt-1 p-3 rounded-large border border-default-200 bg-content1 shadow-large w-[19rem]">
                    <div className="flex items-center justify-between mb-2">
                        <Button size="sm" isIconOnly variant="light" className="w-7 h-7 min-w-7" onPress={() => setView(prev)} aria-label="Previous month">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
                        </Button>
                        <div className="text-small font-medium tabular-nums">
                            {MONTH_NAMES[view.month - 1]} {view.year}
                        </div>
                        <Button size="sm" isIconOnly variant="light" className="w-7 h-7 min-w-7" onPress={() => setView(next)} aria-label="Next month">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18l6-6-6-6" /></svg>
                        </Button>
                    </div>

                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {WEEKDAYS.map((w) => (
                            <div key={w} className="h-6 flex items-center justify-center text-tiny text-default-400">{w}</div>
                        ))}
                    </div>

                    <div className="grid grid-cols-7 gap-0.5">
                        {cells.map((d, i) => {
                            if (!d) return <div key={`x${i}`} className="h-7" />;
                            const isFrom = d === from, isTo = d === to;
                            const between = inRange(d) && !isFrom && !isTo;
                            const isToday = d === today;
                            const future = d > today;
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    className={`h-7 rounded-medium text-tiny tabular-nums transition-colors
                                        ${isFrom || isTo
                                            ? "bg-primary text-primary-foreground font-semibold"
                                            : between
                                                ? "bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200"
                                                : future
                                                    ? "text-default-300 hover:bg-default-100"
                                                    : "hover:bg-default-100"}
                                        ${isToday && !isFrom && !isTo ? "ring-1 ring-inset ring-primary-300" : ""}`}
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
                            <Button size="sm" variant="light" className="h-7 px-2 text-tiny"
                                onPress={() => {
                                    const t = statsToday();
                                    const w = statsDateAdd(t, -6);
                                    onChange(w, t);
                                    setView(parseStatsDate(w)!);
                                    setAnchor("from");
                                }}>
                                {locale?.Last7 || "7d"}
                            </Button>
                            <Button size="sm" variant="light" className="h-7 px-2 text-tiny"
                                onPress={() => {
                                    const t = statsToday();
                                    const w = statsDateAdd(t, -29);
                                    onChange(w, t);
                                    setView(parseStatsDate(w)!);
                                    setAnchor("from");
                                }}>
                                {locale?.Last30 || "30d"}
                            </Button>
                            <Button size="sm" variant="light" className="h-7 px-2 text-tiny"
                                onPress={() => {
                                    // Month-to-date, which is what most billing
                                    // questions are actually asking for.
                                    const t = statsToday();
                                    onChange(`${t.slice(0, 6)}01`, t);
                                    setView(parseStatsDate(t)!);
                                    setAnchor("from");
                                }}>
                                {locale?.MonthToDate || "MTD"}
                            </Button>
                        </div>
                        <span className="text-tiny text-default-400">
                            {(locale?.DayCount || "{n}d").replace("{n}", String(statsDaySpan(from, to)))}
                        </span>
                    </div>
                    <div className="mt-1 text-tiny text-default-400">
                        {label}
                    </div>
                </div>
            )}
        </div>
    );
}
