export type Currency = "USD" | "CNY";
const EXCHANGE_RATE = 7;

export function formatPrice(usdPerMToken: number, currency: Currency): string {
    if (usdPerMToken <= 0) return "-";
    const value = currency === "CNY" ? usdPerMToken * EXCHANGE_RATE : usdPerMToken;
    const symbol = currency === "CNY" ? "\u00a5" : "$";
    return `${symbol}${value.toFixed(3).slice(0, 5)}/M`;
}

export function getCurrencySymbol(currency: Currency): string {
    return currency === "CNY" ? "\u00a5" : "$";
}
