// All money amounts share one unit per database. The server injects which one
// into the page, so the symbol follows the admin's conversion instead of
// assuming it already happened.
function symbol(): string {
    return window.__APP_CONFIG__?.money_currency === "CNY" ? "\u00a5" : "$";
}

export function money(value: number, digits = 2): string {
    const sign = value < 0 ? "-" : "";
    return `${sign}${symbol()}${Math.abs(value).toFixed(digits)}`;
}
