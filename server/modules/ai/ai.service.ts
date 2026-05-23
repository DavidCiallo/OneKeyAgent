import { HttpsProxyAgent } from "https-proxy-agent";
import https from "https";
import http from "http";
import {
    ChatCompletionsServiceResponse,
    CompletionServiceResponse,
    ModelsServiceResponse,
} from "../../../shared/modules/ai/ai.interface";
import { getAllModels, logUsage } from "./ai.session";
import { ProviderService } from "../provider/provider.service";
import { AccountService } from "../account/account.service";
import { AccountRoleService } from "../role/role.service";
import { toAnthropicBody, anthropicToOpenAI, antMessagesToOpenAI, openAIToAntMessages, openAIToAntStream, antStreamToOpenAI } from "./ai.trans";
import Repository from "../../lib/repository";

/** Calculate cost in USDT for a request */
function calculateCost(inputTokens: number, outputTokens: number, inputPrice: number, outputPrice: number): number {
    // inputPrice/outputPrice are in dollars per 1M tokens
    const cost = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
    return Math.round(cost * 1_000_000) / 1_000_000; // 6 decimal precision
}

const WEEKLY_LIMIT = 100; // $100 per week

/** Get total weekly spending for an account */
async function getWeeklySpending(accountId: string): Promise<number> {
    const since = Date.now() - 7 * 86400000;
    const repo = Repository.instance<any>("usage_log");
    const logs = await repo.find({ account_id: accountId }, { since });
    let total = 0;
    for (const log of logs) {
        const cost = (log.input_tokens * (log.input_price || 0) + log.output_tokens * (log.output_price || 0)) / 1_000_000;
        total += Math.round(cost * 1_000_000) / 1_000_000;
    }
    return Math.round(total * 1_000_000) / 1_000_000;
}

/** Deduct balance from account, throw 429 if insufficient */
async function deductBalance(accountId: string, cost: number): Promise<void> {
    if (cost <= 0) return;

    // Check weekly limit
    const weeklySpent = await getWeeklySpending(accountId);
    if (weeklySpent + cost > WEEKLY_LIMIT) {
        throw new Error("429 Weekly spending limit reached");
    }

    const balance = await AccountService.getBalance(accountId);
    if (balance < cost) {
        throw new Error("429 Insufficient balance");
    }
    // Balance is computed from UsageLog — no manual deduction needed
}

/** Get model prices for an alias */
async function getModelPrices(alias: string): Promise<{ inputPrice: number; outputPrice: number }> {
    const models = await getAllModels();
    const match = models.find(m => m.alias === alias);
    return {
        inputPrice: match?.input_price ?? 0,
        outputPrice: match?.output_price ?? 0,
    };
}

/** Build Authorization header value based on auth type */
function buildAuthHeader(api_key: string | undefined, authType?: string): string {
    if (!api_key) return "";
    if (authType === "custom") return api_key;
    return `Bearer ${api_key}`;
}

/** Build request headers and URL path based on api type */
function buildRequestConfig(
    baseURL: string,
    api_key: string | undefined,
    authType: string | undefined,
    apiType: string | undefined,
    body: Record<string, any>,
): { url: URL; headers: Record<string, string>; requestBody: string } {
    const isAnthropic = apiType === "anthropic";
    const path = isAnthropic ? "/messages" : "/chat/completions";
    const url = new URL(`${baseURL}${path}`);

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
        headers["Authorization"] = buildAuthHeader(api_key, authType);
    }

    return { url, headers, requestBody: postBody };
}

/** Try to call upstream provider, returns response data or null */
async function tryProvider(
    baseURL: string,
    model: string,
    api_key: string | undefined,
    proxyURL: string | undefined,
    body: Record<string, any>,
    authType?: string,
    apiType?: string,
): Promise<any> {
    const { url, headers, requestBody: postBody } = buildRequestConfig(baseURL, api_key, authType, apiType, body);
    const agent = proxyURL ? new HttpsProxyAgent(proxyURL) : undefined;

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
                if (res.statusCode !== 200) return resolve(null);
                try {
                    const parsed = JSON.parse(data);
                    if (apiType === "anthropic") {
                        resolve(anthropicToOpenAI(parsed, model));
                    } else {
                        resolve(parsed);
                    }
                } catch { resolve(null); }
            });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(postBody);
        req.end();
    });
}

/** Try to call upstream provider for streaming, returns the body stream or null */
async function tryProviderStream(
    baseURL: string,
    model: string,
    api_key: string | undefined,
    proxyURL: string | undefined,
    body: Record<string, any>,
    authType?: string,
    apiType?: string,
): Promise<ReadableStream<Uint8Array> | null> {
    const { url, headers, requestBody: postBody } = buildRequestConfig(baseURL, api_key, authType, apiType, body);
    const agent = proxyURL ? new HttpsProxyAgent(proxyURL) : undefined;

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
                res.resume();
                return resolve(null);
            }
            // Anthropic SSE uses event: / data: lines — pass through, client handles SSE
            const ts = new TransformStream<Uint8Array, Uint8Array>();
            const writer = ts.writable.getWriter();
            res.on("data", (chunk: Buffer) => writer.write(chunk));
            res.on("end", () => writer.close());
            res.on("error", () => writer.close());

            // Normalize Anthropic SSE to OpenAI SSE so downstream always gets OpenAI format
            if (apiType === "anthropic") {
                resolve(antStreamToOpenAI(ts.readable));
            } else {
                resolve(ts.readable);
            }
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(postBody);
        req.end();
    });
}

/** Get allowed model aliases for a non-admin account, null means no restriction */
async function getAllowedModelAliases(accountId: string): Promise<string[] | null> {
    const account = await AccountService.findOne(accountId);
    if (!account || account.is_admin) return null; // admin — no restriction

    const models = await getAllModels();
    const publicAliases = models.filter(m => m.is_public).map(m => m.alias);

    const roles = await AccountRoleService.findByAccount(accountId);
    const modelRoles = roles.filter(r => r.type === "model").map(r => r.name);

    // Union of explicitly assigned roles + public model aliases
    return [...new Set([...modelRoles, ...publicAliases])];
}

/** Check if the requested model alias is allowed for this account */
async function requireModelAccess(accountId: string, alias: string): Promise<void> {
    const allowed = await getAllowedModelAliases(accountId);
    if (allowed === null) return; // admin or no account — unrestricted
    if (!allowed.includes(alias)) {
        throw new Error(`Model "${alias}" is not authorized for this account`);
    }
}

async function chatHex(body: Record<string, any>, accountId: string): Promise<any> {
    const requestedAlias = body.model;

    await requireModelAccess(accountId, requestedAlias);

    const providers = await ProviderService.getProvidersByAlias(requestedAlias);
    if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

    for (const provider of providers) {
        const requestBody: Record<string, any> = {
            ...body,
            stream: false,
            thinking: { type: "disabled" },
            model: provider.model,
        };

        const data = await tryProvider(provider.base_url, provider.model, provider.api_key, provider.proxy_url, requestBody, provider.auth_type, provider.api_type);
        if (!data) {
            ProviderService.recordFail(provider.id);
            continue;
        }

        ProviderService.recordSuccess(provider.id);

        const { inputPrice: input_price, outputPrice: output_price } = await getModelPrices(requestedAlias);
        const { usage } = data;
        // OpenAI format: prompt_tokens/completion_tokens; Anthropic format: input_tokens/output_tokens
        const rawInput = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
        const rawOutput = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
        // Deduct balance
        const cost = calculateCost(rawInput, rawOutput, input_price, output_price);
        await deductBalance(accountId, cost);

        await logUsage({
            accountId,
            modelAlias: requestedAlias,
            providerId: provider.id,
            inputTokens: rawInput,
            outputTokens: rawOutput,
            inputPrice: input_price,
            outputPrice: output_price,
        });
        await AccountService.updateBalance(accountId, -cost);
        data.model = requestedAlias;
        return data;
    }

    throw new Error("All providers failed");
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

async function chatHexStream(body: Record<string, any>, accountId: string): Promise<ReadableStream<Uint8Array>> {
    const requestedAlias = body.model;

    await requireModelAccess(accountId, requestedAlias);

    const providers = await ProviderService.getProvidersByAlias(requestedAlias);
    if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

    for (const provider of providers) {
        const requestBody: Record<string, any> = {
            ...body,
            stream: true,
            thinking: { type: "disabled" },
            model: provider.model,
        };

        const bodyStream = await tryProviderStream(
            provider.base_url,
            provider.model,
            provider.api_key,
            provider.proxy_url,
            requestBody,
            provider.auth_type,
            provider.api_type
        );
        if (!bodyStream) {
            ProviderService.recordFail(provider.id);
            continue;
        }

        ProviderService.recordSuccess(provider.id);

        const [upstreamForward, parseStream] = (bodyStream.tee() as [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>]);

        const ts = new TransformStream<Uint8Array, Uint8Array>();
        const forwardStream = ts.readable;
        safePipe(upstreamForward.getReader(), ts.writable.getWriter());

        // Background parse usage
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
                    let pendingAnthropic = false;
                    const lines = text.split('\n');
                    for (const line of lines) {
                        // Anthropic format: event: message_delta — mark next data line
                        if (line === 'event: message_delta') {
                            pendingAnthropic = true;
                            continue;
                        }
                        if (line.startsWith('data: ') && !line.startsWith('data: [DONE]')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.usage) {
                                    usageData = data.usage;
                                } else if (pendingAnthropic && data.type === 'message_delta' && data.usage) {
                                    usageData = {
                                        input_tokens: data.usage.input_tokens || 0,
                                        output_tokens: data.usage.output_tokens || 0,
                                    };
                                }
                                // Count output content for fallback estimation
                                const content = data.choices?.[0]?.delta?.content || '';
                                if (content) {
                                    estimatedOutputChars += content.length;
                                }
                            } catch { }
                            pendingAnthropic = false;
                        }
                    }
                }

                const { inputPrice: input_price, outputPrice: output_price } = await getModelPrices(requestedAlias);

                let rawInput: number;
                let rawOutput: number;

                if (usageData) {
                    rawInput = usageData.input_tokens ?? usageData.prompt_tokens ?? 0;
                    rawOutput = usageData.output_tokens ?? usageData.completion_tokens ?? 0;
                } else {
                    rawInput = 0;
                    rawOutput = Math.max(1, Math.round(estimatedOutputChars / 4));
                }

                // Deduct balance
                const cost = calculateCost(rawInput, rawOutput, input_price, output_price);
                await deductBalance(accountId, cost);

                await logUsage({
                    accountId,
                    modelAlias: requestedAlias,
                    providerId: provider.id,
                    inputTokens: rawInput,
                    outputTokens: rawOutput,
                    inputPrice: input_price,
                    outputPrice: output_price,
                });
                await AccountService.updateBalance(accountId, -cost);
            } catch (err) {
            }
        })();

        return forwardStream;
    }

    throw new Error("All providers failed for streaming");
}

function requestJson(urlStr: string, api_key: string | undefined, postBody: string, proxyURL: string | undefined, authType?: string): Promise<any> {
    const url = new URL(urlStr);
    const agent = proxyURL ? new HttpsProxyAgent(proxyURL) : undefined;
    return new Promise((resolve) => {
        const lib = url.protocol === "https:" ? https : http;
        const opts: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": buildAuthHeader(api_key, authType),
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

async function completeHex(body: Record<string, any>, accountId: string): Promise<any> {
    const requestedAlias = body.model;

    await requireModelAccess(accountId, requestedAlias);

    const providers = await ProviderService.getProvidersByAlias(requestedAlias);
    if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

    for (const provider of providers) {
        const data = await requestJson(`${provider.base_url}/completions`, provider.api_key, JSON.stringify({ ...body, stream: false, model: provider.model }), provider.proxy_url, provider.auth_type);
        if (!data) {
            ProviderService.recordFail(provider.id);
            continue;
        }

        ProviderService.recordSuccess(provider.id);
        const { inputPrice: input_price, outputPrice: output_price } = await getModelPrices(requestedAlias);
        // OpenAI format: prompt_tokens/completion_tokens; Anthropic format: input_tokens/output_tokens
        const rawInput = data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? 0;
        const rawOutput = data.usage?.output_tokens ?? data.usage?.completion_tokens ?? 0;

        // Deduct balance
        const cost = calculateCost(rawInput, rawOutput, input_price, output_price);
        await deductBalance(accountId, cost);

        await logUsage({
            accountId,
            modelAlias: requestedAlias,
            providerId: provider.id,
            inputTokens: rawInput,
            outputTokens: rawOutput,
            inputPrice: input_price,
            outputPrice: output_price,
        });
        await AccountService.updateBalance(accountId, -cost);
        return data;
    }

    throw new Error("All providers failed");
}

function requestStream(urlStr: string, api_key: string | undefined, postBody: string, proxyURL: string | undefined, authType?: string, apiType?: string): Promise<ReadableStream<Uint8Array> | null> {
    const url = new URL(urlStr);
    const agent = proxyURL ? new HttpsProxyAgent(proxyURL) : undefined;
    return new Promise((resolve) => {
        const lib = url.protocol === "https:" ? https : http;
        const opts: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": buildAuthHeader(api_key, authType),
                "Content-Length": Buffer.byteLength(postBody).toString(),
            },
            agent,
            timeout: 300_000,
        };
        const req = lib.request(opts, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return resolve(null);
            }
            const ts = new TransformStream<Uint8Array, Uint8Array>();
            const writer = ts.writable.getWriter();
            res.on("data", (chunk: Buffer) => writer.write(chunk));
            res.on("end", () => writer.close());
            res.on("error", () => writer.close());

            // Normalize Anthropic SSE to OpenAI SSE so downstream always gets OpenAI format
            if (apiType === "anthropic") {
                resolve(antStreamToOpenAI(ts.readable));
            } else {
                resolve(ts.readable);
            }
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(postBody);
        req.end();
    });
}

async function completeHexStream(body: Record<string, any>, accountId: string): Promise<ReadableStream<Uint8Array>> {
    const requestedAlias = body.model;

    await requireModelAccess(accountId, requestedAlias);

    const providers = await ProviderService.getProvidersByAlias(requestedAlias);
    if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

    for (const provider of providers) {
        const bodyStream = await requestStream(`${provider.base_url}/completions`, provider.api_key, JSON.stringify({ ...body, stream: true, model: provider.model }), provider.proxy_url, provider.auth_type, provider.api_type);
        if (!bodyStream) {
            ProviderService.recordFail(provider.id);
            continue;
        }

        ProviderService.recordSuccess(provider.id);

        const [upstreamForward, parseStream] = (bodyStream.tee() as [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>]);

        const ts = new TransformStream<Uint8Array, Uint8Array>();
        const forwardStream = ts.readable;
        safePipe(upstreamForward.getReader(), ts.writable.getWriter());

        // Background parse usage
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
                                const data = JSON.parse(line.slice(6));
                                if (data.usage) {
                                    usageData = data.usage;
                                }
                                const content = data.choices?.[0]?.delta?.content || data.choices?.[0]?.text || '';
                                if (content) {
                                    estimatedOutputChars += content.length;
                                }
                            } catch { }
                        }
                    }
                }

                const { inputPrice: input_price, outputPrice: output_price } = await getModelPrices(requestedAlias);

                let rawInput: number;
                let rawOutput: number;

                if (usageData) {
                    rawInput = usageData.input_tokens ?? usageData.prompt_tokens ?? 0;
                    rawOutput = usageData.output_tokens ?? usageData.completion_tokens ?? 0;
                } else {
                    rawInput = 0;
                    rawOutput = Math.max(1, Math.round(estimatedOutputChars / 4));
                }

                const cost = calculateCost(rawInput, rawOutput, input_price, output_price);
                await deductBalance(accountId, cost);

                await logUsage({
                    accountId,
                    modelAlias: requestedAlias,
                    providerId: provider.id,
                    inputTokens: rawInput,
                    outputTokens: rawOutput,
                    inputPrice: input_price,
                    outputPrice: output_price,
                });
                await AccountService.updateBalance(accountId, -cost);
            } catch (err) {
            }
        })();

        return forwardStream;
    }

    throw new Error("All providers failed for streaming");
}

export class AiService {
    static async chatCompletions(data: Record<string, any>, accountId: string = ""): Promise<ChatCompletionsServiceResponse> {
        return await chatHex(data, accountId) as any;
    }

    static async chatCompletionsStream(data: Record<string, any>, accountId: string = ""): Promise<ReadableStream<Uint8Array>> {
        return await chatHexStream(data, accountId);
    }

    static async completions(data: Record<string, any>, accountId: string = ""): Promise<CompletionServiceResponse> {
        return await completeHex(data, accountId);
    }

    static async completionsStream(data: Record<string, any>, accountId: string = ""): Promise<ReadableStream<Uint8Array>> {
        return await completeHexStream(data, accountId);
    }

    static async listModels(accountId: string = ""): Promise<ModelsServiceResponse> {
        const models = await getAllModels();
        const allowed = accountId ? await getAllowedModelAliases(accountId) : null;

        const seen = new Set<string>();
        const data = [];
        for (const m of models) {
            const name = m.alias || "";
            if (!name || seen.has(name)) continue;
            if (allowed !== null && !allowed.includes(name)) continue; // filter by permission
            seen.add(name);
            data.push({
                id: name,
                object: "model",
                created: m.create_time,
                owned_by: "onekey",
                input_price: m.input_price,
                output_price: m.output_price,
            });
        }
        return { data };
    }

    /** Anthropic /v1/messages non-streaming: convert request → call chatHex → convert response back */
    static async antMessages(data: Record<string, any>, accountId: string): Promise<Record<string, any>> {
        const openaiBody = antMessagesToOpenAI(data);
        const result = await chatHex(openaiBody, accountId);
        return openAIToAntMessages(result, data.model);
    }

    /** Anthropic /v1/messages streaming: convert request → call chatHexStream → convert SSE stream */
    static async antMessagesStream(data: Record<string, any>, accountId: string): Promise<ReadableStream<Uint8Array>> {
        const openaiBody = antMessagesToOpenAI(data);
        const upstream = await chatHexStream(openaiBody, accountId);
        return openAIToAntStream(upstream);
    }
}
