import { toAnthropicBody } from "./ai.trans";

/** Build Authorization header value based on auth type */
export function buildAuthHeader(api_key: string | undefined, auth_type?: string): string {
    if (!api_key) return "";
    if (auth_type === "custom") return api_key;
    return `Bearer ${api_key}`;
}

/** Build request headers and URL path based on api type */
export function buildRequestConfig(
    base_url: string,
    api_key: string | undefined,
    auth_type: string | undefined,
    api_type: string | undefined,
    body: Record<string, any>,
): { url: URL; headers: Record<string, string>; requestBody: string } {
    const isAnthropic = api_type === "anthropic";
    const path = isAnthropic ? "/messages" : "/chat/completions";
    const url = new URL(`${base_url}${path}`);

    const postBody = isAnthropic
        ? JSON.stringify(toAnthropicBody(body))
        : JSON.stringify(body);

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postBody).toString(),
    };

    if (isAnthropic) {
        headers["x-api-key"] = api_key || "";
        headers["anthropic-version"] = "2023-06-01";
    } else {
        headers["Authorization"] = buildAuthHeader(api_key, auth_type);
    }

    return { url, headers, requestBody: postBody };
}

/** Calculate cost in USDT for a request */
export function calculateCost(
    input_tokens: number,
    cached_input_tokens: number,
    output_tokens: number,
    input_price: number,
    cache_price: number,
    output_price: number,
): number {
    // input_price/cache_price/output_price are in dollars per 1M tokens
    // If cache_price is not set (0), fall back to input_price
    const effectiveCachePrice = cache_price > 0 ? cache_price : input_price;
    const nonCached = Math.max(0, input_tokens - cached_input_tokens);
    const cost = (cached_input_tokens * effectiveCachePrice + nonCached * input_price + output_tokens * output_price) / 1_000_000;
    return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal precision
}

/** Determine thinking/reasoning config from model alias suffix */
export function getThinkingConfig(alias: string): { thinking: { type: string }; reasoning_effort?: string } {
    const match = alias.match(/^(.*)-think-(low|medium|high|max)$/);
    if (match) {
        return {
            thinking: { type: "enabled" },
            reasoning_effort: match[2] as "low" | "medium" | "high" | "max",
        };
    }else{
        return { thinking: { type: "disabled" } };
    }
}
