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
import { buildRequestConfig, calculateCost, getThinkingConfig } from "./ai.builder";
import { SessionReasoningEntity } from "../../../shared/modules/session/session_reasoning.entity";

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
}

/** Extract cached input tokens from upstream usage (supports multiple vendor formats) */
function extractCachedTokens(usage: any): number {
    if (!usage) return 0;
    // OpenAI format
    const a = usage?.prompt_tokens_details?.cached_tokens ?? 0;
    // Alternate format
    const b = usage?.prompt_cache_hit_tokens ?? 0;
    // Fallback: if only miss_tokens is provided, compute from total
    const c = usage?.prompt_cache_miss_tokens != null
        ? Math.max(0, (usage?.prompt_tokens ?? 0) - usage.prompt_cache_miss_tokens)
        : 0;
    return Math.max(a, b, c, 0);
}

/** Get model prices for an alias */
async function getModelPrices(alias: string): Promise<{ input_price: number; cache_price: number; output_price: number }> {
    const models = await getAllModels();
    const match = models.find(m => m.alias === alias);
    return {
        input_price: match?.input_price ?? 0,
        cache_price: match?.cache_price ?? 0,
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
    api_type?: string,
): Promise<any> {
    const { url, headers, requestBody: postBody } = buildRequestConfig(base_url, api_key, auth_type, api_type, body);
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
                    return resolve(null);
                }
                try {
                    const parsed = JSON.parse(data);
                    if (api_type === "anthropic") {
                        resolve(anthropicToOpenAI(parsed, model));
                    } else {
                        resolve(parsed);
                    }
                } catch (e) {
                    resolve(null);
                }
            });
        });
        req.on("error", (e) => {
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
    api_type?: string,
): Promise<{ stream: ReadableStream<Uint8Array> | null; reasoningContent: string }> {
    const { url, headers, requestBody: postBody } = buildRequestConfig(base_url, api_key, auth_type, api_type, body);
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
                    resolve({ stream: null, reasoningContent: "" });
                });
                return;
            }

            // Build a ReadableStream directly from the Node response to avoid
            // TransformStream backpressure buffering (especially with thinking mode)
            let localReasoning = "";

            const rawStream = new ReadableStream({
                start(controller) {
                    let closed = false;
                    res.on("data", (chunk: Buffer) => {
                        if (closed) return;
                        try {
                            controller.enqueue(new Uint8Array(chunk));
                        } catch {
                            closed = true;
                            return;
                        }

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
                                    }
                                } catch { }
                            }
                        }
                    });
                    res.on("end", () => {
                        if (closed) return;
                        try { controller.close(); } catch { closed = true; }
                    });
                    res.on("error", (e: any) => {
                        if (closed) return;
                        closed = true;
                        console.log("[AI] Error response:", e);
                        try { controller.error(e); } catch { }
                    });
                },
            });

            resolve({
                stream: api_type === "anthropic" ? antStreamToOpenAI(rawStream) : rawStream,
                reasoningContent: localReasoning,
            });
        });

        req.on("error", (e) => {
            console.error("[AI] Error request", e);
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

const reasoningRepo = Repository.instance<SessionReasoningEntity>("session_reasoning");

export class AiService {
    static async chatCompletions(data: Record<string, any>, account_id: string): Promise<CompletionServiceResponse> {
        const requestedAlias = data.model;

        await requireModelAccess(account_id, requestedAlias);

        const providers = await ProviderService.getProvidersByAlias(requestedAlias);
        if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

        const firstUserMsg = data.messages.find((m: any) => m.role === "user")?.content ?? "";
        const sessionKey = `${account_id}::${Buffer.from(JSON.stringify(firstUserMsg)).toString("base64url").slice(0, 16)}`;

        for (const provider of providers) {
            const requestBody: Record<string, any> = {
                ...data,
                stream: false,
                model: provider.model,
            };
            const thinkConfig = provider.supports_thinking ? getThinkingConfig(requestedAlias, provider.api_type, provider.supports_reasoning_effort) : {};
            const thinkingEnabled = !!(thinkConfig.thinking?.type === "enabled" || thinkConfig.reasoning_effort);
            if (thinkingEnabled) {
                Object.assign(requestBody, thinkConfig);

                const savedRecords = await reasoningRepo.find({ session_key: sessionKey });
                const saved = new Map<string, string>();
                for (const r of savedRecords) {
                    saved.set(r.tool_call_id, r.reasoning_content);
                }
                for (const msg of requestBody.messages) {
                    if (msg.role === "assistant") {
                        let rc = "";
                        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                            for (const tc of msg.tool_calls) {
                                if (tc.id && saved.has(tc.id)) {
                                    rc = saved.get(tc.id)!;
                                    break;
                                }
                            }
                        }
                        msg.reasoning_content = rc;
                    }
                }
            }

            const rdata = await tryProvider(provider.base_url, provider.model, provider.api_key, provider.proxy_url, requestBody, provider.auth_type, provider.api_type);
            if (!rdata) {
                await new Promise((r) => setTimeout(r, 500));
                continue;
            }

            const { input_price, cache_price, output_price } = await getModelPrices(requestedAlias);
            const { usage } = rdata;
            // OpenAI format: prompt_tokens/completion_tokens; Anthropic format: input_tokens/output_tokens
            const rawInput = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
            const rawOutput = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
            const cachedInput = extractCachedTokens(usage);
            // Deduct balance
            const cost = calculateCost(rawInput, cachedInput, rawOutput, input_price, cache_price, output_price);
            await deductBalance(account_id, cost);
            await logUsage({
                account_id,
                model_alias: requestedAlias,
                provider_id: provider.id,
                input_tokens: rawInput,
                cached_input_tokens: cachedInput,
                output_tokens: rawOutput,
                input_price,
                cache_price,
                output_price,
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
        const sessionKey = `${account_id}::${Buffer.from(JSON.stringify(firstUserMsg)).toString("base64url").slice(0, 16)}`;


        for (const provider of [...providers]) {
            const requestBody: Record<string, any> = { ...data, stream: true, model: provider.model };
            const thinkConfig = provider.supports_thinking ? getThinkingConfig(requestedAlias, provider.api_type, provider.supports_reasoning_effort) : {};
            const thinkingEnabled = !!(thinkConfig.thinking?.type === "enabled" || thinkConfig.reasoning_effort);
            if (thinkingEnabled) {
                Object.assign(requestBody, thinkConfig);
            }

            // Inject reasoning_content into all assistant messages (thinking mode requires this field)
            if (thinkingEnabled) {
                const savedRecords = await reasoningRepo.find({ session_key: sessionKey });
                const saved = new Map<string, string>();
                for (const r of savedRecords) {
                    saved.set(r.tool_call_id, r.reasoning_content);
                }
                for (const msg of requestBody.messages) {
                    if (msg.role === "assistant") {
                        let rc = "";
                        if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
                            for (const tc of msg.tool_calls) {
                                if (tc.id && saved.has(tc.id)) {
                                    rc = saved.get(tc.id)!;
                                    break;
                                }
                            }
                        }
                        msg.reasoning_content = rc;
                    }
                }
            }

            const { base_url, api_key, proxy_url, auth_type, api_type } = provider;
            const result = await tryProviderStream(base_url, api_key, proxy_url, requestBody, auth_type, api_type);

            if (!result?.stream) {
                await new Promise((r) => setTimeout(r, 500));
                continue;
            }

            // Save reasoning content keyed by tool_call id
            if (thinkingEnabled && result.reasoningContent) {
                const msgs = data.messages;
                let tcId: string | null = null;
                for (let i = msgs.length - 1; i >= 0; i--) {
                    const m = msgs[i];
                    if (m.role === "assistant" && m.tool_calls && Array.isArray(m.tool_calls)) {
                        for (const tc of m.tool_calls) {
                            if (tc.id) {
                                tcId = tc.id;
                                break;
                            }
                        }
                        break;
                    }
                }
                if (tcId) {
                    // Piggyback cleanup: delete reasoning records older than 14 days
                    const first = await reasoningRepo.findOne({});
                    if (first && first.create_time && Date.now() - first.create_time > 14 * 86400000) {
                        await reasoningRepo.hardDelete({ id: first.id });
                    }

                    await reasoningRepo.insert({
                        session_key: sessionKey,
                        tool_call_id: tcId,
                        reasoning_content: result.reasoningContent,
                    });
                }
            }

            // Stream pass-through with inline cost parsing — avoids tee() which buffers
            // both branches in memory (OOM risk with thinking mode & slow consumers)
            const upstreamReader = result.stream.getReader();
            const decoder = new TextDecoder();
            let usageData: any = null;
            let estimatedOutputChars = 0;
            let costDeducted = false;

            async function tryDeductCost() {
                if (costDeducted) return;
                costDeducted = true;
                try {
                    const { input_price, cache_price, output_price } = await getModelPrices(requestedAlias);
                    const rawInput = usageData?.input_tokens ?? usageData?.prompt_tokens ?? 0;
                    const rawOutput = usageData?.output_tokens ?? usageData?.completion_tokens ?? Math.max(1, Math.round(estimatedOutputChars / 4));
                    const cachedInput = extractCachedTokens(usageData);
                    const cost = calculateCost(rawInput, cachedInput, rawOutput, input_price, cache_price, output_price);
                    await deductBalance(account_id, cost);
                    await logUsage({
                        account_id,
                        model_alias: requestedAlias,
                        provider_id: provider.id,
                        input_tokens: rawInput,
                        cached_input_tokens: cachedInput,
                        output_tokens: rawOutput,
                        input_price,
                        cache_price,
                        output_price,
                    });
                    await AccountService.updateBalance(account_id, -cost);
                } catch { }
            }

            const passthrough = new ReadableStream<Uint8Array>({
                async pull(controller) {
                    try {
                        const { done, value } = await upstreamReader.read();
                        if (done) {
                            await tryDeductCost();
                            controller.close();
                            return;
                        }

                        // Parse SSE data from the chunk (for cost tracking)
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

                        controller.enqueue(value);
                    } catch (e) {
                        await tryDeductCost();
                        controller.error(e);
                    }
                },
                cancel() {
                    upstreamReader.cancel().catch(() => { });
                },
            });

            return passthrough;
        }
        throw new Error("This model reach using limit. Please try again later.");
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
            const { alias: name, create_time: created, input_price, cache_price, output_price } = m;
            if (!name || seen.has(name)) continue;
            if (allowed !== null && !allowed.includes(name)) continue;
            seen.add(name);
            data.push({ id: name, object: "model", created, owned_by: "onekey", input_price, cache_price, output_price });
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
