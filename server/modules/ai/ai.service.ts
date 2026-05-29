import { HttpsProxyAgent } from "https-proxy-agent";
import https from "https";
import http from "http";
import { CompletionServiceResponse, ModelsServiceResponse } from "../../../shared/modules/ai/ai.interface";
import { getAllModels, logUsage } from "./ai.session";
import { ProviderService } from "../provider/provider.service";
import { AccountService } from "../account/account.service";
import { AccountRoleService } from "../role/role.service";
import { anthropicToOpenAI, antMessagesToOpenAI, openAIToAntMessages, openAIToAntStream, antStreamToOpenAI } from "./ai.trans";
import Repository from "../../lib/repository";
import fs from "fs";
import { buildAuthHeader, buildRequestConfig, calculateCost, getThinkingConfig } from "./ai.builder";

const WEEKLY_LIMIT = 100; // $100 per week

/** Get total weekly spending for an account (uses pre-aggregated usage_bucket) */
async function getWeeklySpending(account_id: string): Promise<number> {
    const since = Date.now() - 7 * 86400000;
    const repo = Repository.instance<any>("usage_bucket");
    const buckets = await repo.find({ account_id: account_id }, { since });
    let total = 0;
    for (const bucket of buckets) {
        total += bucket.cost || 0;
    }
    return Math.round(total * 1_000_000) / 1_000_000;
}

/** Deduct balance from account, throw 429 if insufficient */
async function deductBalance(account_id: string, cost: number): Promise<void> {
    if (cost <= 0) return;

    // Check weekly limit
    const weeklySpent = await getWeeklySpending(account_id);
    if (weeklySpent + cost > WEEKLY_LIMIT) {
        throw new Error("429 Weekly spending limit reached");
    }

    const balance = await AccountService.getBalance(account_id);
    if (balance < cost) {
        throw new Error("429 Insufficient balance");
    }
    // Balance is computed from UsageLog — no manual deduction needed
}

/** Get model prices for an alias */
async function getModelPrices(alias: string): Promise<{ input_price: number; output_price: number }> {
    const models = await getAllModels();
    const match = models.find(m => m.alias === alias);
    return {
        input_price: match?.input_price ?? 0,
        output_price: match?.output_price ?? 0,
    };
}

/** Try to call upstream provider, returns response data or null */
async function tryProvider(
    base_url: string,
    model: string,
    api_key: string | undefined,
    proxy_url: string | undefined,
    body: Record<string, any>,
    auth_type?: string,
    apiType?: string,
): Promise<any> {
    const { url, headers, requestBody: postBody } = buildRequestConfig(base_url, api_key, auth_type, apiType, body);
    const agent = proxy_url ? new HttpsProxyAgent(proxy_url) : undefined;

    return new Promise((resolve) => {
        const lib = url.protocol === "https:" ? https : http;
        const opts: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "POST",
            headers,
            agent,
            timeout: 300_000,
        };
        const req = lib.request(opts, (res: any) => {
            let data = "";
            res.on("data", (chunk: Buffer) => data += chunk);
            res.on("end", () => {
                if (res.statusCode !== 200) {
                    console.log("[AI] Error response:", res.statusCode, data)
                    return resolve(null);
                }
                try {
                    const parsed = JSON.parse(data);
                    if (apiType === "anthropic") {
                        resolve(anthropicToOpenAI(parsed, model));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    console.log("[AI] Error parsing response 143", e)
                    resolve(null);
                }
            });
        });
        req.on("error", (e) => {
            console.log("[AI] Error request 149:", e)
            resolve(null);
        });
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(postBody);
        req.end();
    });
}

/** Try to call upstream provider for streaming, returns the body stream or null */
async function tryProviderStream(
    base_url: string,
    api_key: string | undefined,
    proxy_url: string | undefined,
    body: Record<string, any>,
    auth_type?: string,
    apiType?: string,
): Promise<{ stream: ReadableStream<Uint8Array> | null; reasoningContent: string }> {
    const { url, headers, requestBody: postBody } = buildRequestConfig(base_url, api_key, auth_type, apiType, body);
    const agent = proxy_url ? new HttpsProxyAgent(proxy_url) : undefined;

    return new Promise((resolve) => {
        const lib = url.protocol === "https:" ? https : http;
        const opts: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "POST",
            headers,
            agent,
            timeout: 300_000,
        };
        const req = lib.request(opts, (res: any) => {
            if (res.statusCode !== 200) {
                // Error handling remains unchanged
                let errorData = "";
                res.on("data", (c: Buffer) => errorData += c);
                res.on("end", () => {
                    fs.writeFileSync("./error.json", JSON.stringify({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: errorData
                    }, null, 2));
                    resolve({ stream: null, reasoningContent: "" });
                });
                return;
            }

            // Accumulate the full reasoning_content for this request
            let localReasoning = "";

            const ts = new TransformStream<Uint8Array, Uint8Array>();
            const writer = ts.writable.getWriter();

            res.on("data", (chunk: Buffer) => {
                // Forward chunk as-is to downstream
                writer.write(chunk);

                // Parse chunk to extract reasoning_content (server-side logging only)
                const text = chunk.toString();
                const lines = text.split("\n");
                for (const line of lines) {
                    if (line.startsWith("data: ") && !line.startsWith("data: [DONE]")) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            const delta = data.choices?.[0]?.delta;
                            if (delta?.reasoning_content) {
                                localReasoning += delta.reasoning_content;
                                // Console logging is available for debugging but not recommended in production
                                // process.stdout.write(delta.reasoning_content);
                            }
                        } catch { }
                    }
                }
            });

            res.on("end", () => {
                writer.close();
                resolve({
                    stream: apiType === "anthropic" ? antStreamToOpenAI(ts.readable) : ts.readable,
                    reasoningContent: localReasoning,
                });
            });

            res.on("error", (e: any) => {
                console.log("[AI] Error response: 194", e);
                writer.close();
                resolve({ stream: null, reasoningContent: "" });
            });
        });

        req.on("error", (e) => {
            console.error("[AI] Error request 206", e);
            resolve({ stream: null, reasoningContent: "" });
        });
        req.on("timeout", () => { req.destroy(); resolve({ stream: null, reasoningContent: "" }); });
        req.write(postBody);
        req.end();
    });
}

/** Get allowed model aliases for a non-admin account, null means no restriction */
async function getAllowedModelAliases(account_id: string): Promise<string[] | null> {
    const account = await AccountService.findOne(account_id);
    if (!account || account.is_admin) return null; // admin — no restriction

    const models = await getAllModels();
    const publicAliases = models.filter(m => m.is_public).map(m => m.alias);

    const roles = await AccountRoleService.findByAccount(account_id);
    const modelRoles = roles.filter(r => r.type === "model").map(r => r.name);

    // Union of explicitly assigned roles + public model aliases
    return [...new Set([...modelRoles, ...publicAliases])];
}

/** Check if the requested model alias is allowed for this account */
async function requireModelAccess(account_id: string, alias: string): Promise<void> {
    const allowed = await getAllowedModelAliases(account_id);
    if (allowed === null) return; // admin or no account — unrestricted
    if (!allowed.includes(alias)) {
        throw new Error(`Model "${alias}" is not authorized for this account`);
    }
}

async function safePipe(reader: ReadableStreamDefaultReader<Uint8Array>, writer: WritableStreamDefaultWriter<Uint8Array>) {
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writer.write(value);
        }
        await writer.close();
    } catch (err) {
    }
}
const sessionReasoningMap = new Map<string, string[]>();

async function requestJson(urlStr: string, api_key: string | undefined, postBody: string, proxy_url: string | undefined, auth_type?: string): Promise<any> {
    const url = new URL(urlStr);
    const agent = proxy_url ? new HttpsProxyAgent(proxy_url) : undefined;
    return new Promise((resolve) => {
        const lib = url.protocol === "https:" ? https : http;
        const opts: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": buildAuthHeader(api_key, auth_type),
                "Content-Length": Buffer.byteLength(postBody).toString(),
            },
            agent,
            timeout: 300_000,
        };
        const req = lib.request(opts, (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => data += chunk);
            res.on("end", () => {
                if (res.statusCode !== 200) return resolve(null);
                try { resolve(JSON.parse(data)); } catch { resolve(null); }
            });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(postBody);
        req.end();
    });
}

export class AiService {
    static async chatCompletions(data: Record<string, any>, account_id: string): Promise<CompletionServiceResponse> {
        const requestedAlias = data.model;

        await requireModelAccess(account_id, requestedAlias);

        const providers = await ProviderService.getProvidersByAlias(requestedAlias);
        if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

        for (const provider of providers) {
            const requestBody: Record<string, any> = {
                ...data,
                stream: false,
                model: provider.model,
            };
            const thinkConfig = getThinkingConfig(requestedAlias);
            if (thinkConfig) {
                Object.assign(requestBody, thinkConfig);
            }

            const rdata = await tryProvider(provider.base_url, provider.model, provider.api_key, provider.proxy_url, requestBody, provider.auth_type, provider.api_type);
            if (!rdata) {
                ProviderService.recordFail(provider.id);
                continue;
            }

            ProviderService.recordSuccess(provider.id);

            const { input_price: input_price, output_price: output_price } = await getModelPrices(requestedAlias);
            const { usage } = data;
            // OpenAI format: prompt_tokens/completion_tokens; Anthropic format: input_tokens/output_tokens
            const rawInput = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
            const rawOutput = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
            // Deduct balance
            const cost = calculateCost(rawInput, rawOutput, input_price, output_price);
            await deductBalance(account_id, cost);
            console.log(`Usage logged: ${rawInput} input tokens, ${rawOutput} output tokens, cost: ${cost}`);
            await logUsage({
                account_id,
                model_alias: requestedAlias,
                provider_id: provider.id,
                input_tokens: rawInput,
                output_tokens: rawOutput,
                input_price: input_price,
                output_price: output_price,
            });
            await AccountService.updateBalance(account_id, -cost);
            rdata.model = requestedAlias;
            return rdata;
        }

        throw new Error("All providers failed");
    }

    static async chatCompletionsStream(data: Record<string, any>, account_id: string): Promise<ReadableStream<Uint8Array>> {
        const requestedAlias = data.model;
        await requireModelAccess(account_id, requestedAlias);

        const providers = await ProviderService.getProvidersByAlias(requestedAlias);
        if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

        const firstUserMsg = data.messages.find((m: any) => m.role === "user")?.content ?? "";
        const sessionKey = `${account_id}::${Buffer.from(JSON.stringify(firstUserMsg)).toString("base64")}`;


        for (const provider of providers) {
            const requestBody: Record<string, any> = { ...data, stream: true, model: provider.model };
            const thinkConfig = getThinkingConfig(requestedAlias);
            Object.assign(requestBody, thinkConfig);
            if (thinkConfig.thinking.type === "enabled") {
                if (sessionReasoningMap.has(sessionKey)) {
                    const saved = sessionReasoningMap.get(sessionKey)!;
                    let idx = 0;
                    for (const msg of data.messages) {
                        if (msg.role === "assistant" && msg.tool_calls) {
                            msg.reasoning_content = idx < saved.length ? saved[idx] : "";
                            idx++;
                        }
                    }
                }
            }
            const { base_url, api_key, proxy_url, auth_type, api_type } = provider;
            const result = await tryProviderStream(base_url, api_key, proxy_url, requestBody, auth_type, api_type);

            if (!result?.stream) { ProviderService.recordFail(provider.id); continue; }
            ProviderService.recordSuccess(provider.id);

            // Save the reasoning content produced this round (push even if empty to keep index alignment)
            const saved = sessionReasoningMap.get(sessionKey) || [];
            saved.push(result.reasoningContent);
            sessionReasoningMap.set(sessionKey, saved);

            const [upstreamForward, parseStream] = result.stream.tee() as [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>];

            (async () => {
                try {
                    const reader = parseStream.getReader();
                    const decoder = new TextDecoder();
                    let usageData: any = null;
                    let estimatedOutputChars = 0;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const text = decoder.decode(value, { stream: true });
                        const lines = text.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('data: ') && !line.startsWith('data: [DONE]')) {
                                try {
                                    const d = JSON.parse(line.slice(6));
                                    if (d.usage) usageData = d.usage;
                                    const content = d.choices?.[0]?.delta?.content || d.choices?.[0]?.text || '';
                                    if (content) estimatedOutputChars += content.length;
                                } catch { }
                            }
                        }
                    }

                    const { input_price, output_price } = await getModelPrices(requestedAlias);
                    const rawInput = usageData?.input_tokens ?? usageData?.prompt_tokens ?? 0;
                    const rawOutput = usageData?.output_tokens ?? usageData?.completion_tokens ?? Math.max(1, Math.round(estimatedOutputChars / 4));
                    const cost = calculateCost(rawInput, rawOutput, input_price, output_price);
                    await deductBalance(account_id, cost);
                    await logUsage({
                        account_id,
                        model_alias: requestedAlias,
                        provider_id: provider.id,
                        input_tokens: rawInput,
                        output_tokens: rawOutput,
                        input_price,
                        output_price,
                    });
                    await AccountService.updateBalance(account_id, -cost);
                } catch { }
            })();

            const ts = new TransformStream<Uint8Array, Uint8Array>();
            safePipe(upstreamForward.getReader(), ts.writable.getWriter());

            return ts.readable;
        }
        throw new Error("All providers failed for streaming");
    }

    static async completions(data: Record<string, any>, account_id: string): Promise<CompletionServiceResponse> {
        const rdata = await this.chatCompletions(data, account_id);
        return rdata;
    }

    static async completionsStream(data: Record<string, any>, account_id: string): Promise<ReadableStream<Uint8Array>> {
        return await this.chatCompletionsStream(data, account_id);
    }

    static async listModels(account_id: string): Promise<ModelsServiceResponse> {
        const models = await getAllModels();
        const allowed = account_id ? await getAllowedModelAliases(account_id) : null;

        const seen = new Set<string>();
        const data = [];
        for (const m of models) {
            const { alias: name, create_time: created, input_price, output_price } = m;
            if (!name || seen.has(name)) continue;
            if (allowed !== null && !allowed.includes(name)) continue;
            seen.add(name);
            data.push({ id: name, object: "model", created, owned_by: "onekey", input_price, output_price });
        }
        return { data };
    }

    /** Anthropic /v1/messages non-streaming: convert request → call chatHex → convert response back */
    static async antMessages(data: Record<string, any>, account_id: string): Promise<Record<string, any>> {
        const openaiBody = antMessagesToOpenAI(data);
        const result = await this.chatCompletions(openaiBody, account_id);
        return openAIToAntMessages(result, data.model);
    }

    /** Anthropic /v1/messages streaming: convert request → call chatHexStream → convert SSE stream */
    static async antMessagesStream(data: Record<string, any>, account_id: string): Promise<ReadableStream<Uint8Array>> {
        const openaiBody = antMessagesToOpenAI(data);
        const upstream = await this.chatCompletionsStream(openaiBody, account_id);
        return openAIToAntStream(upstream);
    }
}
