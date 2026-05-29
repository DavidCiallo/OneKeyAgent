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
    apiType: string | undefined,
    body: Record<string, any>,
): { url: URL; headers: Record<string, string>; requestBody: string } {
    const isAnthropic = apiType === "anthropic";
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

    // Debug logs only — no longer mutating message content
    // console.log("--- Outgoing messages (first 50 chars of content) ---");
    // for (const msg of body.messages) {
    //     console.log({
    //         role: msg.role,
    //         content: typeof msg.content === "string" ? msg.content.slice(0, 50) : msg.content,
    //         tool_call_id: msg.tool_call_id ?? "",
    //         has_tool_calls: !!msg.tool_calls,
    //         has_reasoning: !!msg.reasoning_content,
    //     });
    // }
    // console.log("--- End of messages ---");

    return { url, headers, requestBody: postBody };
}