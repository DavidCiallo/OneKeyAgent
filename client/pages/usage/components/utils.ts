/** Derive a stable hue from a provider name string */
export function stringToColor(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        hash = s.charCodeAt(i) + ((hash << 5) - hash);
    }
    const abs = Math.abs(hash);
    const hue = abs % 360;
    const sat = 50 + (abs % 30);       // 50%–80%
    const lit = 35 + ((abs >> 8) % 25); // 35%–60%
    return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

/** Format tokens in millions */
export function fmtM(v: number): string {
    return (v / 1000000).toFixed(2) + "m";
}

/** Format tokens in thousands */
export function fmtK(v: number): string {
    return (v / 1000).toFixed(2) + "k";
}

/** Format timestamp to MM/DD hh:mm */
export function format24Time(ts: number): string {
    const d = new Date(ts);
    const MM = String(d.getMonth() + 1).padStart(2, "0");
    const DD = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${MM}/${DD} ${hh}:${mm}`;
}

/** Strip email portion "(...)" from account name */
export function stripEmail(name: string): string {
    return name.replace(/\(.*\)/, "").trim();
}