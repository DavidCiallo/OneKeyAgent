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
import { AccountEntity } from "../../../shared/modules/account/account.entity";
import Repository from "../../lib/repository";

const accountRepo = Repository.instance<AccountEntity>("Account");

const DEFAULT_MONTHLY_LIMIT = 100_000_000; // 100M tokens default

/** Apply throttle delay based on usage ratio (weekly) */
async function applyThrottle(accountId: string): Promise<void> {
    const account = await accountRepo.findOne({ id: accountId });
    if (!account) return;

    const limit = (account as any).monthly_limit || DEFAULT_MONTHLY_LIMIT;
    const weekLimit = limit / 4;
    const billed = await UsageService.weeklyBilledTokens(accountId);
    const ratio = weekLimit > 0 ? billed / weekLimit : 0;

    let delay = 0;
    if (ratio > 1.0) {
        delay = 5000; // >100% → +5s
    } else if (ratio > 0.75) {
        delay = 2000; // 75-100% → +2s
    } else if (ratio > 0.5) {
        delay = 500;  // 50-75% → +0.5s
    }

    if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

/** Build Authorization header value based on auth type */
function buildAuthHeader(apiKey: string | undefined, authType?: string): string {
    if (!apiKey) return "";
    if (authType === "custom") return apiKey;
    return `Bearer ${apiKey}`;
}

/** Try to call upstream provider, returns response data or null */
async function tryProvider(
    baseURL: string,
    model: string,
    apiKey: string | undefined,
    proxyURL: string | undefined,
    body: Record<string, any>,
    authType?: string,
): Promise<any> {
    const url = new URL(`${baseURL}/chat/completions`);
    const postBody = JSON.stringify(body);
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
            res.on("data", (chunk) => data += chunk);
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

/** Try to call upstream provider for streaming, returns the body stream or null */
async function tryProviderStream(
    baseURL: string,
    model: string,
    apiKey: string | undefined,
    proxyURL: string | undefined,
    body: Record<string, any>,
    authType?: string,
): Promise<ReadableStream<Uint8Array> | null> {
    const url = new URL(`${baseURL}/chat/completions`);
    const postBody = JSON.stringify(body);
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
            // Convert Node.js stream to Web ReadableStream
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

async function chatHex(body: Record<string, any>, accountId: string): Promise<any> {
    const t0 = Date.now();
    const requestedAlias = body.model;

    await applyThrottle(accountId);

    const providers = await ProviderService.getProvidersByAlias(requestedAlias);
    if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

    for (const provider of providers) {
        const requestBody: Record<string, any> = {
            ...body,
            stream: false,
            thinking: { type: "disabled" },
            model: provider.model,
        };

        const data = await tryProvider(provider.baseURL, provider.model, provider.apiKey, provider.proxyURL, requestBody, provider.authType);
        if (!data) {
            ProviderService.recordFail(provider.id);
            continue;
        }

        ProviderService.recordSuccess(provider.id);

        const ms = Date.now() - t0;
        const tier = await getModelTier(requestedAlias);
        const { usage } = data;
        const rawInput = usage?.prompt_tokens || 0;
        const rawOutput = usage?.completion_tokens || 0;

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

    await applyThrottle(accountId);

    const providers = await ProviderService.getProvidersByAlias(requestedAlias);
    if (providers.length === 0) throw new Error(`No providers found for alias: ${requestedAlias}`);

    for (const provider of providers) {
        const requestBody: Record<string, any> = {
            ...body,
            stream: true,
            thinking: { type: "disabled" },
            model: provider.model,
        };

        const bodyStream = await tryProviderStream(provider.baseURL, provider.model, provider.apiKey, provider.proxyURL, requestBody, provider.authType);
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
                let usage: any = null;

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
                                    usage = data.usage;
                                }
                            } catch { }
                        }
                    }
                }

                if (usage) {
                    const ms = Date.now() - t0;
                    const tier = await getModelTier(requestedAlias);
                    const rawInput = usage.prompt_tokens || 0;
                    const rawOutput = usage.completion_tokens || 0;
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
            res.on("data", (chunk) => data += chunk);
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

    await applyThrottle(accountId);

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
        const rawInput = data.usage?.prompt_tokens || 0;
        const rawOutput = data.usage?.completion_tokens || 0;

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

    await applyThrottle(accountId);

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

    static async listModels(): Promise<ModelsServiceResponse> {
        const models = await getAllModels();
        const seen = new Set<string>();
        const data = [];
        for (const m of models) {
            const name = m.alias || "";
            if (name && !seen.has(name)) {
                seen.add(name);
                data.push({
                    id: name,
                    object: "model",
                    created: m.create_time,
                    owned_by: "onekey",
                });
            }
        }
        return { data };
    }
}
