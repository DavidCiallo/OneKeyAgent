// All money amounts are in CNY; the symbol and precision live here so a future
// unit change is one edit, not twenty.
export function money(value: number, digits = 2): string {
    const sign = value < 0 ? "-" : "";
    return `${sign}\u00a5${Math.abs(value).toFixed(digits)}`;
}
