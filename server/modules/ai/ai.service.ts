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
import { UsageService } from "../usage/usage.service";
import { AccountService } from "../account/account.service";
import { AccountRoleService } from "../role/role.service";
import { SubscriptionService } from "../subscription/subscription.service";

const DEFAULT_MONTHLY_LIMIT = 90_000_000; // 90M tokens default (free plan)

/** Check monthly usage limit, throw 429 if exceeded */
async function checkUsageLimit(accountId: string): Promise<void> {
    const account = await AccountService.findOne(accountId);
    if (!account) return;

    const plan = await SubscriptionService.findPlanByName(account.plan || "free");
    const limit = plan?.monthly_limit || DEFAULT_MONTHLY_LIMIT;
    const billed = await UsageService.monthlyBilledTokens(accountId);

    if (billed >= limit) {
        throw new Error("429 Too Many Requests. Monthly usage limit exceeded");
    }
}

/** Build Authorization header value based on auth type */
function buildAuthHeader(apiKey: string | undefined, authType?: string): string {
    if (!apiKey) return "";
    if (authType === "custom") return apiKey;
    return `Bearer ${apiKey}`;
}

/** Convert OpenAI-format chat body to Anthropic format */
function toAnthropicBody(body: Record<string, any>): Record<string, any> {
    const messages = body.messages || [];
    const systemMsg = messages.filter((m: any) => m.role === "system");
    const chatMessages = messages.filter((m: any) => m.role !== "system");

    const anthropicMessages = chatMessages.map((m: any) => ({
        role: m.role,
        content: [{ type: "text", text: m.content }],
    }));

    const result: Record<string, any> = {
        model: body.model,
        max_tokens: body.max_tokens || 4096,
        messages: anthropicMessages,
        stream: body.stream,
    };

    if (systemMsg.length > 0) {
        result.system = systemMsg.map((m: any) => ({ type: "text", text: m.content }));
    }

    return result;
}

/** Convert Anthropic non-stream response to OpenAI-compatible format */
function anthropicToOpenAI(data: any, model: string): any {
    const content = data.content?.find((c: any) => c.type === "text")?.text || "";
    return {
        id: data.id,
        model,
        choices: [{
            index: 0,
            message: { role: "assistant", content },
            finish_reason: data.stop_reason === "end_turn" ? "stop" : data.stop_reason,
        }],
        usage: {
            prompt_tokens: data.usage?.input_tokens || 0,
            completion_tokens: data.usage?.output_tokens || 0,
            total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
    };
}

/** Build request headers and URL path based on api type */
function buildRequestConfig(
    baseURL: string,
    apiKey: string | undefined,
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
        headers["x-api-key"] = apiKey || "";
        headers["anthropic-version"] = "2023-06-01";
    } else {
        headers["Authorization"] = buildAuthHeader(apiKey, authType);
    }

    return { url, headers, requestBody: postBody };
}

/** Try to call upstream provider, returns response data or null */
async function tryProvider(
    baseURL: string,
    model: string,
    apiKey: string | undefined,
    proxyURL: string | undefined,
    body: Record<string, any>,
    authType?: string,
    apiType?: string,
): Promise<any> {
    const { url, headers, requestBody: postBody } = buildRequestConfig(baseURL, apiKey, authType, apiType, body);
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
    apiKey: string | undefined,
    proxyURL: string | undefined,
    body: Record<string, any>,
    authType?: string,
    apiType?: string,
): Promise<ReadableStream<Uint8Array> | null> {
    const { url, headers, requestBody: postBody } = buildRequestConfig(baseURL, apiKey, authType, apiType, body);
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
            resolve(ts.readable);
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(postBody);
        req.end();
    });
}

/** Get model tier for an alias, defaults to 1 */
async function getModelTier(alias: string): Promise<number> {
    const models = await getAllModels();
    const match = models.find(m => m.alias === alias);
    return match?.tier ?? 1;
}

/** Get allowed model aliases for a non-admin account, null means no restriction */
async function getAllowedModelAliases(accountId: string): Promise<string[] | null> {
    const account = await AccountService.findOne(accountId);
    if (!account || account.is_admin) return null; // admin — no restriction

    const roles = await AccountRoleService.findByAccount(accountId);
    const modelRoles = roles.filter(r => r.type === "model");
    return modelRoles.map(r => r.name);
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
    const t0 = Date.now();
    const requestedAlias = body.model;

    await requireModelAccess(accountId, requestedAlias);
    await checkUsageLimit(accountId);

    const providers = await ProviderService.getProvidersByAlias(requestedAlias);
    if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

    for (const provider of providers) {
        const requestBody: Record<string, any> = {
            ...body,
            stream: false,
            thinking: { type: "disabled" },
            model: provider.model,
        };

        const data = await tryProvider(provider.baseURL, provider.model, provider.apiKey, provider.proxyURL, requestBody, provider.authType, provider.apiType);
        if (!data) {
            ProviderService.recordFail(provider.id);
            continue;
        }

        ProviderService.recordSuccess(provider.id);

        const ms = Date.now() - t0;
        const tier = await getModelTier(requestedAlias);
        const { usage } = data;
        // OpenAI format: prompt_tokens/completion_tokens; Anthropic format: input_tokens/output_tokens
        const rawInput = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
        const rawOutput = usage?.output_tokens ?? usage?.completion_tokens ?? 0;

        await logUsage({
            accountId,
            modelAlias: requestedAlias,
            providerId: provider.id,
            inputTokens: rawInput * tier,
            outputTokens: rawOutput * tier,
        });

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
    await checkUsageLimit(accountId);

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
            provider.baseURL,
            provider.model,
            provider.apiKey,
            provider.proxyURL,
            requestBody,
            provider.authType,
            provider.apiType
        );
        if (!bodyStream) {
            ProviderService.recordFail(provider.id);
            continue;
        }

        ProviderService.recordSuccess(provider.id);

        const t0 = Date.now();
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
                            } catch { }
                            pendingAnthropic = false;
                        }
                    }
                }

                if (usageData) {
                    const ms = Date.now() - t0;
                    const tier = await getModelTier(requestedAlias);
                    // OpenAI format: prompt_tokens/completion_tokens
                    // Anthropic format: input_tokens/output_tokens
                    const rawInput = usageData.input_tokens ?? usageData.prompt_tokens ?? 0;
                    const rawOutput = usageData.output_tokens ?? usageData.completion_tokens ?? 0;
                    await logUsage({
                        accountId,
                        modelAlias: requestedAlias,
                        providerId: provider.id,
                        inputTokens: rawInput * tier,
                        outputTokens: rawOutput * tier,
                    });
                }
            } catch (err) {
            }
        })();

        return forwardStream;
    }

    throw new Error("All providers failed for streaming");
}

function requestJson(urlStr: string, apiKey: string | undefined, postBody: string, proxyURL: string | undefined, authType?: string): Promise<any> {
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
                "Authorization": buildAuthHeader(apiKey, authType),
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
    const t0 = Date.now();
    const requestedAlias = body.model;

    await requireModelAccess(accountId, requestedAlias);
    await checkUsageLimit(accountId);

    const providers = await ProviderService.getProvidersByAlias(requestedAlias);
    if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

    for (const provider of providers) {
        const data = await requestJson(`${provider.baseURL}/completions`, provider.apiKey, JSON.stringify({ ...body, stream: false, model: provider.model }), provider.proxyURL, provider.authType);
        if (!data) {
            ProviderService.recordFail(provider.id);
            continue;
        }

        ProviderService.recordSuccess(provider.id);
        const ms = Date.now() - t0;
        const tier = await getModelTier(requestedAlias);
        // OpenAI format: prompt_tokens/completion_tokens; Anthropic format: input_tokens/output_tokens
        const rawInput = data.usage?.input_tokens ?? data.usage?.prompt_tokens ?? 0;
        const rawOutput = data.usage?.output_tokens ?? data.usage?.completion_tokens ?? 0;

        await logUsage({
            accountId,
            modelAlias: requestedAlias,
            providerId: provider.id,
            inputTokens: rawInput * tier,
            outputTokens: rawOutput * tier,
        });
        return data;
    }

    throw new Error("All providers failed");
}

function requestStream(urlStr: string, apiKey: string | undefined, postBody: string, proxyURL: string | undefined, authType?: string): Promise<ReadableStream<Uint8Array> | null> {
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
                "Authorization": buildAuthHeader(apiKey, authType),
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
            resolve(ts.readable);
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
    await checkUsageLimit(accountId);

    const providers = await ProviderService.getProvidersByAlias(requestedAlias);
    if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

    for (const provider of providers) {
        const bodyStream = await requestStream(`${provider.baseURL}/completions`, provider.apiKey, JSON.stringify({ ...body, stream: true, model: provider.model }), provider.proxyURL, provider.authType);
        if (!bodyStream) {
            ProviderService.recordFail(provider.id);
            continue;
        }

        ProviderService.recordSuccess(provider.id);

        const ts = new TransformStream<Uint8Array, Uint8Array>();
        const forwardStream = ts.readable;
        safePipe(bodyStream.getReader(), ts.writable.getWriter());

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
                tier: m.tier,
            });
        }
        return { data };
    }
}
