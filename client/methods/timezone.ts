/**
 * Statistics are bucketed on the server's clock (`routing_timezone`), not the
 * viewer's. Formatting those timestamps with the browser's own zone would
 * render every label at a different hour than the boundary it belongs to, so
 * every chart label goes through the zone the server reports — and only falls
 * back to the browser's zone when the server did not configure one.
 */

let cached: string | undefined;

/** The IANA zone the server cut its buckets in, or undefined for "browser". */
export function statsTimezone(): string | undefined {
    if (cached === undefined) {
        cached = window.__APP_CONFIG__?.timezone || undefined;
    }
    return cached;
}

/**
 * The calendar parts of a timestamp as seen in the stats zone. `hourCycle: h23`
 * keeps midnight as 00 rather than 24, which is what a chart axis wants.
 */
function partsIn(ts: number, zone: string) {
    const fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    });
    const out: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(ts))) {
        if (p.type !== "literal") out[p.type] = p.value;
    }
    return out;
}

/**
 * Format a timestamp's calendar fields in the stats zone. Falls back to the
 * browser's own getters when no zone is configured, so behaviour is unchanged
 * for an install that never set one.
 */
export function statsParts(ts: number): {
    year: string; month: string; day: string; hour: string; minute: string;
} {
    const zone = statsTimezone();
    if (zone) {
        const p = partsIn(ts, zone);
        return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
    }
    const d = new Date(ts);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return {
        year: String(d.getFullYear()),
        month: p2(d.getMonth() + 1),
        day: p2(d.getDate()),
        hour: p2(d.getHours()),
        minute: p2(d.getMinutes()),
    };
}

/** MM/DD HH:mm in the stats zone. */
export function statsLabel(ts: number): string {
    const p = statsParts(ts);
    return `${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/** HH:mm in the stats zone. */
export function statsClock(ts: number): string {
    const p = statsParts(ts);
    return `${p.hour}:${p.minute}`;
}

/** The zone's UTC offset in milliseconds at a given instant. */
function zoneOffsetMs(ts: number, zone: string): number {
    // Formatting the instant as if its fields were UTC and diffing against the
    // instant gives the offset without a date library.
    const p = partsIn(ts, zone);
    const asUTC = Date.UTC(
        Number(p.year), Number(p.month) - 1, Number(p.day),
        Number(p.hour), Number(p.minute),
    );
    return asUTC - ts;
}

/**
 * Midnight of the stats-zone day containing ts, as a UTC millisecond stamp.
 * Mirrors the server's `store.DayStart` so the client requests the same window
 * the server buckets into.
 *
 * This is a fixed-point iteration, not a single offset subtraction. On a DST
 * transition the local midnight can sit on the other side of the jump from ts,
 * so the offset measured at ts is the wrong one to subtract; re-measuring at
 * each candidate walks to the correct instant, and a wall-clock-midnight test
 * is what recognises it (comparing only the day-of-month does not, because both
 * candidates usually name the same day).
 */
export function statsDayStart(ts: number): number {
    const zone = statsTimezone();
    if (!zone) {
        const d = new Date(ts);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }
    const p = partsIn(ts, zone);
    const target = { year: Number(p.year), month: Number(p.month), day: Number(p.day) };

    let start = Date.UTC(target.year, target.month - 1, target.day) - zoneOffsetMs(ts, zone);
    for (let i = 0; i < 3; i++) {
        const q = partsIn(start, zone);
        if (
            Number(q.year) === target.year &&
            Number(q.month) === target.month &&
            Number(q.day) === target.day &&
            q.hour === "00" &&
            q.minute === "00"
        ) {
            return start;
        }
        const want = Date.UTC(target.year, target.month - 1, target.day);
        start = want - zoneOffsetMs(start, zone);
    }
    return start;
}

/**
 * The stats-zone-aligned boundary at or below ts for a step, mirroring the
 * server's `store.AlignDown`. Steps of an hour or less floor on absolute time;
 * longer steps anchor at the zone's midnight so a 6h window lands on
 * 00:00/06:00/12:00/18:00 local, which is what the server does.
 */
export function statsAlignDown(ts: number, stepMs: number): number {
    if (stepMs <= 0) return ts;
    if (stepMs <= 3_600_000) return Math.floor(ts / stepMs) * stepMs;
    const day = statsDayStart(ts);
    return day + Math.floor((ts - day) / stepMs) * stepMs;
}

// ─────────────────────── calendar dates (yyyymmdd) ───────────────────────
//
// The usage page's range filter is a pair of calendar dates rather than a
// lookback, so it has to convert a date the operator typed in the stats zone
// into the exact millisecond boundary the server buckets on. Doing that with
// `new Date("2024-06-15")` would parse it as UTC midnight, which is the wrong
// instant for any zone east or west of UTC — the same class of bug the
// statistics clock was introduced to fix.

/** A calendar date in the stats zone, as `yyyymmdd`. */
export type StatsDate = string;

const DATE_RE = /^(\d{4})(\d{2})(\d{2})$/;

/** Parse `yyyymmdd` to its parts, or null when it is not a valid date. */
export function parseStatsDate(s: string): { year: number; month: number; day: number } | null {
    const m = DATE_RE.exec((s || "").trim());
    if (!m) return null;
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    // Reject a day that does not exist in that month (20240231).
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
        return null;
    }
    return { year, month, day };
}

/** Today's date in the stats zone, as `yyyymmdd`. */
export function statsToday(now: number = Date.now()): StatsDate {
    const p = statsParts(now);
    return `${p.year}${p.month}${p.day}`;
}

/**
 * Midnight opening the given stats-zone calendar date.
 *
 * Via the same fixed-point walk as statsDayStart: the offset is measured at a
 * UTC guess and re-measured at each candidate, so a date whose midnight falls on
 * the other side of a DST transition still resolves to the real local midnight.
 */
export function statsDateStart(date: StatsDate): number {
    const parsed = parseStatsDate(date);
    if (!parsed) return NaN;
    const zone = statsTimezone();
    if (!zone) {
        return new Date(parsed.year, parsed.month - 1, parsed.day).getTime();
    }
    const want = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
    let start = want - zoneOffsetMs(want, zone);
    for (let i = 0; i < 3; i++) {
        const q = partsIn(start, zone);
        if (
            Number(q.year) === parsed.year &&
            Number(q.month) === parsed.month &&
            Number(q.day) === parsed.day &&
            q.hour === "00" &&
            q.minute === "00"
        ) {
            return start;
        }
        start = want - zoneOffsetMs(start, zone);
    }
    return start;
}

/**
 * The exclusive end of a `from`–`to` range, i.e. the midnight after `to`.
 *
 * Advancing through the calendar rather than adding 86_400_000 ms is what makes
 * the range cover a DST day completely: a local day is 23 or 25 hours on a
 * transition, and a fixed 24h would leave an hour of the last day outside the
 * window (or pull an hour of the next day in).
 */
export function statsDateEndExclusive(to: StatsDate): number {
    const parsed = parseStatsDate(to);
    if (!parsed) return NaN;
    const zone = statsTimezone();
    if (!zone) {
        return new Date(parsed.year, parsed.month - 1, parsed.day + 1).getTime();
    }
    // Normalise through the Date constructor so month/year rollover is handled.
    const rolled = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));
    const next = `${rolled.getUTCFullYear()}${String(rolled.getUTCMonth() + 1).padStart(2, "0")}${String(rolled.getUTCDate()).padStart(2, "0")}`;
    return statsDateStart(next);
}

/** Render a date for display: `2024-06-15`. */
export function formatStatsDate(date: StatsDate): string {
    const p = parseStatsDate(date);
    if (!p) return date;
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** How many calendar days a range spans, inclusive of both ends. */
export function statsDaySpan(from: StatsDate, to: StatsDate): number {
    const a = parseStatsDate(from), b = parseStatsDate(to);
    if (!a || !b) return 0;
    const av = Date.UTC(a.year, a.month - 1, a.day);
    const bv = Date.UTC(b.year, b.month - 1, b.day);
    return Math.round((bv - av) / 86_400_000) + 1;
}

/** Shift a date by whole calendar days. */
export function statsDateAdd(date: StatsDate, days: number): StatsDate {
    const p = parseStatsDate(date);
    if (!p) return date;
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}
