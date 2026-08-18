import { toAnthropicBody, toGeminiBody } from "./ai.trans";

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
    enable_search?: number,
    stream?: boolean,
): { url: URL; headers: Record<string, string>; requestBody: string } {
    const isAnthropic = api_type === "anthropic";
    const isGemini = api_type === "gemini";

    let path = "/chat/completions";
    if (isAnthropic) path = "/messages";
    if (isGemini) {
        const action = stream ? "streamGenerateContent" : "generateContent";
        path = `/models/${encodeURIComponent(body.model || "gemini-2.5-flash")}:${action}${stream ? "?alt=sse" : ""}`;
    }

    const url = new URL(`${base_url}${path}`);

    let postBody: string;
    if (isAnthropic) {
        postBody = JSON.stringify(toAnthropicBody(body));
    } else if (isGemini) {
        postBody = JSON.stringify(toGeminiBody(body, enable_search));
    } else {
        // OpenAI-compatible: normalize thinking intent to the standard `reasoning_effort`.
        // Anthropic-style `thinking:{type:"enabled"}` gets translated — budget_tokens
        // maps to a medium/high effort level so the intent isn't silently dropped.
        const cleanBody = { ...body };
        if (cleanBody.thinking?.type === "enabled" && !cleanBody.reasoning_effort) {
            const budget = cleanBody.thinking.budget_tokens;
            if (typeof budget === "number") {
                cleanBody.reasoning_effort = budget >= 16384 ? "high" : budget >= 8192 ? "medium" : "low";
            } else {
                cleanBody.reasoning_effort = "high";
            }
        }
        delete cleanBody.thinking;
        postBody = JSON.stringify(cleanBody);
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postBody).toString(),
    };

    if (isAnthropic) {
        headers["x-api-key"] = api_key || "";
        headers["anthropic-version"] = "2023-06-01";
    } else if (isGemini) {
        headers["x-goog-api-key"] = api_key || "";
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
