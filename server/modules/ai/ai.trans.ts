/**
 * AI protocol conversion utilities: OpenAI ↔ Anthropic / Gemini format interchange
 */

/** Convert OpenAI-format chat body to Anthropic format (for upstream Anthropic provider) */
export function toAnthropicBody(body: Record<string, any>): Record<string, any> {
    const messages = body.messages || [];
    const systemMsg = messages.filter((m: any) => m.role === "system");
    const chatMessages = messages.filter((m: any) => m.role !== "system");

    const anthropicMessages = chatMessages.map((m: any) => {
        // If message already has content as array (Anthropic format), pass through
        if (Array.isArray(m.content)) {
            return { role: m.role, content: m.content };
        }

        const content: Array<Record<string, any>> = [];

        // Text content
        if (m.content) {
            content.push({ type: "text", text: m.content });
        }

        // OpenAI tool_calls → Anthropic tool_use blocks
        if (m.tool_calls && Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) {
                content.push({
                    type: "tool_use",
                    id: tc.id,
                    name: tc.function?.name || "",
                    input: typeof tc.function?.arguments === "string"
                        ? JSON.parse(tc.function.arguments)
                        : tc.function?.arguments || {},
                });
            }
        }

        return { role: m.role, content };
    });

    // Handle "tool" role messages — they become "user" with tool_result blocks
    for (let i = 0; i < chatMessages.length; i++) {
        const m = chatMessages[i];
        if (m.role === "tool") {
            anthropicMessages[i] = {
                role: "user",
                content: [{
                    type: "tool_result",
                    tool_use_id: m.tool_call_id,
                    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
                }],
            };
        }
    }

    const result: Record<string, any> = {
        model: body.model,
        max_tokens: body.max_tokens || 4096,
        messages: anthropicMessages,
        stream: body.stream,
    };

    if (systemMsg.length > 0) {
        result.system = systemMsg.map((m: any) => ({ type: "text", text: m.content }));
    }

    if (body.thinking) {
        result.thinking = body.thinking;
    } else if (body.reasoning_effort) {
        // OpenAI-style reasoning_effort → Anthropic extended thinking with a budget
        const budgetMap: Record<string, number> = {
            low: 2048,
            medium: 8192,
            high: 16384,
            max: 32768,
        };
        const budget = typeof body.reasoning_effort === "number"
            ? body.reasoning_effort
            : budgetMap[body.reasoning_effort];
        if (budget) {
            result.thinking = { type: "enabled", budget_tokens: budget };
        }
    }

    return result;
}

/** Convert Anthropic /v1/messages request to internal OpenAI-format body */
export function antMessagesToOpenAI(body: Record<string, any>): Record<string, any> {
    const antMessages = body.messages || [];
    const messages: Array<Record<string, any>> = [];

    // Anthropic system param → OpenAI system message
    if (body.system) {
        if (typeof body.system === "string") {
            messages.push({ role: "system", content: body.system });
        } else if (Array.isArray(body.system)) {
            const text = body.system.map((b: any) => b.text || "").join("\n");
            messages.push({ role: "system", content: text });
        }
    }

    for (const m of antMessages) {
        const role = m.role === "assistant" ? "assistant" : "user";

        if (typeof m.content === "string") {
            messages.push({ role, content: m.content });
        } else if (Array.isArray(m.content)) {
            // Anthropic content blocks — may contain text, tool_use, tool_result
            const textParts: string[] = [];
            let toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> | undefined;
            let functionResult: { name: string; content: string } | undefined;

            for (const block of m.content) {
                if (block.type === "text") {
                    textParts.push(block.text);
                } else if (block.type === "tool_use") {
                    // Anthropic tool_use → OpenAI tool_calls
                    if (!toolCalls) toolCalls = [];
                    toolCalls.push({
                        id: block.id,
                        type: "function",
                        function: {
                            name: block.name,
                            arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input),
                        },
                    });
                } else if (block.type === "tool_result") {
                    // Anthropic tool_result → OpenAI function result message
                    const toolUseId = block.tool_use_id;
                    const resultContent = typeof block.content === "string"
                        ? block.content
                        : Array.isArray(block.content)
                            ? block.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
                            : "";
                    // tool_result becomes a "tool" role message in OpenAI format
                    functionResult = { name: toolUseId, content: resultContent };
                }
            }

            // text content
            const content = textParts.join("\n");

            if (role === "assistant" && toolCalls) {
                // Assistant message with tool_calls
                const msg: Record<string, any> = { role: "assistant", content };
                msg.tool_calls = toolCalls;
                messages.push(msg);
            } else if (role === "user" && functionResult) {
                // User message with tool result → OpenAI "tool" role message
                messages.push({
                    role: "tool",
                    tool_call_id: functionResult.name,
                    content: functionResult.content,
                });
            } else {
                messages.push({ role, content });
            }
        }
    }

    const result: Record<string, any> = {
        model: body.model,
        messages,
        max_tokens: body.max_tokens,
        temperature: body.temperature,
        stream: body.stream,
    };

    // Pass through tools → OpenAI tools format
    if (body.tools && Array.isArray(body.tools)) {
        result.tools = body.tools.map((tool: any) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description || "",
                parameters: tool.input_schema || {},
            },
        }));
    }

    // Pass through tool_choice
    if (body.tool_choice) {
        result.tool_choice = body.tool_choice;
    }

    return result;
}

/** Convert internal OpenAI-format response to Anthropic /v1/messages format (non-streaming) */
export function openAIToAntMessages(data: any, model: string): Record<string, any> {
    const choice = data.choices?.[0];
    const msg = choice?.message || {};

    // Build Anthropic content blocks
    const content: Array<Record<string, any>> = [];

    // Text content
    if (msg.content) {
        content.push({ type: "text", text: msg.content });
    }

    // Tool calls → Anthropic tool_use blocks
    if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
            let input: any = tc.function?.arguments || {};
            if (typeof input === "string") {
                try { input = JSON.parse(input); } catch { input = {}; }
            }
            content.push({
                type: "tool_use",
                id: tc.id,
                name: tc.function?.name || "",
                input,
            });
        }
    }

    // Determine stop_reason
    let stopReason: string | null = choice?.finish_reason === "stop" ? "end_turn"
        : choice?.finish_reason === "tool_calls" ? "tool_use"
        : choice?.finish_reason || "end_turn";

    return {
        id: data.id,
        type: "message",
        role: "assistant",
        content,
        model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: data.usage?.prompt_tokens || 0,
            output_tokens: data.usage?.completion_tokens || 0,
        },
    };
}

/** Convert Anthropic non-stream response to OpenAI-compatible format (for internal proxy) */
export function anthropicToOpenAI(data: any, model: string): any {
    const textContent = data.content?.find((c: any) => c.type === "text")?.text || "";
    const toolUseBlocks = data.content?.filter((c: any) => c.type === "tool_use") || [];

    const message: Record<string, any> = { role: "assistant", content: textContent };

    if (toolUseBlocks.length > 0) {
        message.tool_calls = toolUseBlocks.map((block: any, idx: number) => ({
            id: block.id,
            type: "function",
            index: idx,
            function: {
                name: block.name || "",
                arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input),
            },
        }));
    }

    return {
        id: data.id,
        model,
        choices: [{
            index: 0,
            message,
            finish_reason: data.stop_reason === "end_turn" ? "stop"
                : data.stop_reason === "tool_use" ? "tool_calls"
                : data.stop_reason || "stop",
        }],
        usage: {
            prompt_tokens: data.usage?.input_tokens || 0,
            completion_tokens: data.usage?.output_tokens || 0,
            total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
        },
    };
}

/**
 * Convert OpenAI SSE stream to Anthropic SSE stream
 * OpenAI format:  data: {"choices":[{"delta":{"content":"..."},"finish_reason":null}]}
 * Anthropic format: event: content_block_delta\ndata: {...}\n\n
 *
 * Handles both text content and tool_calls in the stream.
 */
export function openAIToAntStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const ts = new TransformStream<Uint8Array, Uint8Array>();
    const writer = ts.writable.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    (async () => {
        try {
            const reader = upstream.getReader();
            let buffer = "";

            // Track content blocks we've started
            // 0 = text block, 1+ = tool_use blocks
            let textBlockIndex = 0;          // which block index for text
            let textBlockStarted = false;
            const toolBlockIndices = new Map<number, number>(); // OpenAI tool index → Anthropic block index
            let finished = false;

            // Anthropic stream must start with message_start event
            let msgStartEmitted = false;

            async function emitContentBlockStart(index: number, block: Record<string, any>) {
                const evt = { type: "content_block_start", index, content_block: block };
                await writer.write(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(evt)}\n\n`));
            }

            async function emitContentBlockDelta(index: number, delta: Record<string, any>) {
                const evt = { type: "content_block_delta", index, delta };
                await writer.write(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(evt)}\n\n`));
            }

            async function emitContentBlockStop(index: number) {
                const evt = { type: "content_block_stop", index };
                await writer.write(encoder.encode(`event: content_block_stop\ndata: ${JSON.stringify(evt)}\n\n`));
            }

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (!line.startsWith("data: ")) continue;
                    const payload = line.slice(6);
                    if (payload === "[DONE]") continue;

                    try {
                        const openaiChunk = JSON.parse(payload);

                        // Emit message_start on first chunk with model name
                        if (!msgStartEmitted) {
                            const msgStartEvent = {
                                type: "message_start",
                                message: {
                                    id: crypto.randomUUID(),
                                    type: "message",
                                    role: "assistant",
                                    content: [],
                                    model: openaiChunk.model || "",
                                    stop_reason: null,
                                    stop_sequence: null,
                                    usage: { input_tokens: 0, output_tokens: 0 },
                                },
                            };
                            await writer.write(encoder.encode(`event: message_start\ndata: ${JSON.stringify(msgStartEvent)}\n\n`));
                            msgStartEmitted = true;
                        }

                        const choices = openaiChunk.choices || [];
                        for (const choice of choices) {
                            const delta = choice.delta || {};
                            const content = delta.content || "";
                            const toolCalls = delta.tool_calls;

                            // Text content handling
                            if (content) {
                                if (!textBlockStarted) {
                                    await emitContentBlockStart(textBlockIndex, { type: "text", text: content });
                                    textBlockStarted = true;
                                } else {
                                    await emitContentBlockDelta(textBlockIndex, { type: "text_delta", text: content });
                                }
                            }

                            // Tool calls handling
                            if (toolCalls && Array.isArray(toolCalls)) {
                                for (const tc of toolCalls) {
                                    const openaiIdx = tc.index;
                                    let antBlockIdx = toolBlockIndices.get(openaiIdx);

                                    if (antBlockIdx === undefined) {
                                        // First chunk for this tool call — assign block index
                                        // Text is always 0; tools start at 1
                                        antBlockIdx = 1 + toolBlockIndices.size;
                                        toolBlockIndices.set(openaiIdx, antBlockIdx);

                                        const func = tc.function || {};
                                        const partialArgs = func.arguments || "";
                                        await emitContentBlockStart(antBlockIdx, {
                                            type: "tool_use",
                                            id: tc.id || "",
                                            name: func.name || "",
                                            input: partialArgs,  // partial JSON string
                                        });
                                    } else {
                                        // Subsequent chunks — delta with partial arguments
                                        const func = tc.function || {};
                                        if (func.arguments) {
                                            await emitContentBlockDelta(antBlockIdx, {
                                                type: "input_json_delta",
                                                partial_json: func.arguments,
                                            });
                                        }
                                    }
                                }
                            }

                            // Finish reason — close content blocks and emit message_delta
                            if (choice.finish_reason && !finished) {
                                finished = true;

                                // Close text block if it was started
                                if (textBlockStarted) {
                                    await emitContentBlockStop(textBlockIndex);
                                }

                                // Close tool blocks
                                for (const antIdx of toolBlockIndices.values()) {
                                    await emitContentBlockStop(antIdx);
                                }

                                const antStopReason = choice.finish_reason === "stop" ? "end_turn"
                                    : choice.finish_reason === "tool_calls" ? "tool_use"
                                    : choice.finish_reason;

                                const stopEvent = {
                                    type: "message_delta",
                                    delta: { stop_reason: antStopReason, stop_sequence: null },
                                    usage: {
                                        input_tokens: openaiChunk.usage?.prompt_tokens || 0,
                                        output_tokens: openaiChunk.usage?.completion_tokens || 0,
                                    },
                                };
                                await writer.write(encoder.encode(`event: message_delta\ndata: ${JSON.stringify(stopEvent)}\n\n`));
                            }
                        }
                    } catch { }
                }
            }

            // If we never saw a finish_reason, close any open blocks
            if (!finished) {
                if (textBlockStarted) await emitContentBlockStop(textBlockIndex);
                for (const antIdx of toolBlockIndices.values()) {
                    await emitContentBlockStop(antIdx);
                }
                const stopEvent = {
                    type: "message_delta",
                    delta: { stop_reason: "end_turn", stop_sequence: null },
                    usage: { input_tokens: 0, output_tokens: 0 },
                };
                await writer.write(encoder.encode(`event: message_delta\ndata: ${JSON.stringify(stopEvent)}\n\n`));
            }

            await writer.write(encoder.encode("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"));
            await writer.close();
        } catch { writer.close(); }
    })();

    return ts.readable;
}

/**
 * Handles text content blocks and tool_use blocks.
 */
export function antStreamToOpenAI(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const ts = new TransformStream<Uint8Array, Uint8Array>();
    const writer = ts.writable.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let model = "";

    (async () => {
        try {
            const reader = upstream.getReader();
            let buffer = "";
            let currentEvent = "";
            let pendingData = "";

            // Track state per content block
            let textAccumulator = "";
            let toolCallAccumulator: Record<number, { id: string; name: string; arguments: string; index: number }> = {};
            let hasText = false;
            let hasTools = false;
            let finished = false;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    if (line.startsWith("event: ")) {
                        currentEvent = line.slice(7).trim();
                        pendingData = "";
                    } else if (line.startsWith("data: ")) {
                        pendingData = line.slice(6);
                    }

                    // When we hit an empty line, process the accumulated event+data
                    if (line === "" && pendingData) {
                        try {
                            const data = JSON.parse(pendingData);
                            const eventType = data.type || currentEvent;

                            if (eventType === "message_start") {
                                model = data.message?.model || model;
                                continue;
                            }

                            if (eventType === "content_block_start") {
                                const block = data.content_block;
                                if (block.type === "text") {
                                    hasText = true;
                                    textAccumulator = block.text || "";
                                } else if (block.type === "tool_use") {
                                    hasTools = true;
                                    const idx = toolCallAccumulator[data.index] ? Object.keys(toolCallAccumulator).length : 0;
                                    toolCallAccumulator[data.index] = {
                                        id: block.id || "",
                                        name: block.name || "",
                                        arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input || {}),
                                        index: idx,
                                    };
                                }
                                continue;
                            }

                            if (eventType === "content_block_delta") {
                                const delta = data.delta;
                                if (delta.type === "text_delta") {
                                    textAccumulator += delta.text || "";
                                } else if (delta.type === "input_json_delta") {
                                    // Find the tool call for this block index
                                    const tc = toolCallAccumulator[data.index];
                                    if (tc) {
                                        tc.arguments += delta.partial_json || "";
                                    }
                                }
                                continue;
                            }

                            if (eventType === "content_block_stop") {
                                // Emit accumulated data as OpenAI SSE chunk
                                const openaiChunk: Record<string, any> = {
                                    id: crypto.randomUUID(),
                                    object: "chat.completion.chunk",
                                    created: Math.floor(Date.now() / 1000),
                                    model,
                                    choices: [{
                                        index: 0,
                                        delta: {} as Record<string, any>,
                                        finish_reason: null,
                                    }],
                                };

                                const delta: Record<string, any> = {};

                                if (hasText && textAccumulator) {
                                    delta.role = "assistant";
                                    delta.content = textAccumulator;
                                }

                                if (hasTools && Object.keys(toolCallAccumulator).length > 0) {
                                    delta.tool_calls = Object.values(toolCallAccumulator).map(tc => ({
                                        id: tc.id,
                                        type: "function",
                                        index: tc.index,
                                        function: {
                                            name: tc.name,
                                            arguments: tc.arguments,
                                        },
                                    }));
                                }

                                openaiChunk.choices[0].delta = delta;
                                await writer.write(encoder.encode(`data: ${JSON.stringify(openaiChunk)}\n\n`));

                                // Reset accumulators for next block
                                textAccumulator = "";
                                toolCallAccumulator = {};
                                hasText = false;
                                hasTools = false;
                                continue;
                            }

                            if (eventType === "message_delta") {
                                if (!finished) {
                                    finished = true;
                                    const stopReason = data.delta?.stop_reason === "end_turn" ? "stop"
                                        : data.delta?.stop_reason === "tool_use" ? "tool_calls"
                                        : data.delta?.stop_reason || "stop";

                                    const finishChunk = {
                                        id: crypto.randomUUID(),
                                        object: "chat.completion.chunk",
                                        created: Math.floor(Date.now() / 1000),
                                        model,
                                        choices: [{
                                            index: 0,
                                            delta: {},
                                            finish_reason: stopReason,
                                        }],
                                        usage: data.usage ? {
                                            prompt_tokens: data.usage.input_tokens || 0,
                                            completion_tokens: data.usage.output_tokens || 0,
                                            total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
                                        } : undefined,
                                    };
                                    await writer.write(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
                                }
                                continue;
                            }

                            if (eventType === "message_stop") {
                                await writer.write(encoder.encode("data: [DONE]\n\n"));
                                continue;
                            }
                        } catch {
                            // skip malformed SSE events
                        }
                        pendingData = "";
                        currentEvent = "";
                    }
                }
            }

            if (!finished) {
                const finishChunk = {
                    id: crypto.randomUUID(),
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                };
                await writer.write(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
                await writer.write(encoder.encode("data: [DONE]\n\n"));
            }

            await writer.close();
        } catch {
            writer.close();
        }
    })();

    return ts.readable;
}

/* ========================================================================
 * Gemini (Google Generative Language API) interchange
 * ===================================================================== */

/**
 * Convert OpenAI-format chat body to Gemini generateContent body.
 * Handles system prompt, function calling (Google FunctionDeclaration) and
 * googleSearch grounding tool passthrough.
 */
export function toGeminiBody(
    body: Record<string, any>,
    enable_search?: number,
): Record<string, any> {
    const messages = body.messages || [];
    const systemMsgs = messages.filter((m: any) => m.role === "system");
    const parts: Array<Record<string, any>> = [];
    // OpenAI tool_call id → function name (needed to emit Gemini functionResponse)
    const functionNameById = new Map<string, string>();

    // system → systemInstruction (suffix), or inline to contents? Gemini supports
    // systemInstruction separately; the role "system" in contents is invalid.
    for (const m of messages) {
        if (m.role === "system") continue;

        // Stash tool_call id → function name mapping for later tool results
        if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) {
                if (tc.id && tc.function?.name) {
                    functionNameById.set(tc.id, tc.function.name);
                }
            }
        }

        // Consecutive user turns must be merged (Gemini contents must alternate)
        if (m.role === "tool") {
            // OpenAI tool result → functionResponse part
            const last = parts[parts.length - 1];
            const fnName = m.name || (m.tool_call_id ? functionNameById.get(m.tool_call_id) || `call_${m.tool_call_id}` : undefined) || "unknown";
            const resp = {
                name: fnName,
                response: {
                    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
                },
            };
            // Gemini requires functionResponse part in a "user" turn
            if (last && last.role === "model") {
                parts.push({ role: "user", parts: [{ functionResponse: resp }] });
            } else {
                if (last) {
                    last.parts = last.parts || [];
                    last.parts.push({ functionResponse: resp });
                } else {
                    parts.push({ role: "user", parts: [{ functionResponse: resp }] });
                }
            }
            continue;
        }

        const role = m.role === "assistant" ? "model" : "user";
        const contentParts: Array<Record<string, any>> = [];

        // Text content
        if (m.content) {
            contentParts.push({ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) });
        }

        // OpenAI tool_calls → Gemini functionCall parts (in a "model" turn)
        if (role === "model" && m.tool_calls && Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) {
                contentParts.push({
                    functionCall: {
                        name: tc.function?.name || "",
                        args: typeof tc.function?.arguments === "string"
                            ? safeJsonParse(tc.function.arguments)
                            : (tc.function?.arguments || {}),
                    },
                });
            }
        }

        // reasoning_content passthrough (not part of Gemini protocol, but keep
        // text content together); Gemini ignores unknown fields but we keep only text.
        // (thought content from previous turns is intentionally dropped)

        if (contentParts.length === 0) continue;

        // Merge with previous turn of same role
        const last = parts[parts.length - 1];
        if (last && last.role === role) {
            last.parts = (last.parts || []).concat(contentParts);
        } else {
            parts.push({ role, parts: contentParts });
        }
    }

    const result: Record<string, any> = {
        contents: parts,
    };

    if (systemMsgs.length > 0) {
        result.systemInstruction = {
            parts: systemMsgs.map((m: any) => ({ text: m.content })),
        };
    }

    // OpenAI tools → Gemini functionDeclarations (must be wrapped)
    if (body.tools && Array.isArray(body.tools)) {
        const functions: Array<Record<string, any>> = [];
        const otherTools: Array<Record<string, any>> = [];
        for (const t of body.tools) {
            if (t.type === "function" && t.function) {
                functions.push({
                    name: t.function.name,
                    description: t.function.description || "",
                    parameters: t.function.parameters || (t.function.input_schema ? t.function.input_schema : {}),
                });
            } else {
                // Already Gemini-style tool entry (googleSearch etc.)
                otherTools.push(t);
            }
        }
        result.tools = [];
        if (functions.length > 0) result.tools.push({ functionDeclarations: functions });
        result.tools.push(...otherTools);
    }

    // Google search grounding tool (enable_search flag on provider)
    if (enable_search) {
        const tools = result.tools || [];
        tools.push({ googleSearch: {} });
        result.tools = tools;
    }

    // Generation config
    const genConfig: Record<string, any> = {};
    if (body.temperature !== undefined) genConfig.temperature = body.temperature;
    if (body.max_tokens !== undefined) genConfig.maxOutputTokens = body.max_tokens;
    if (body.top_p !== undefined) genConfig.topP = body.top_p;
    if (body.stop && Array.isArray(body.stop) && body.stop.length) genConfig.stopSequences = body.stop;
    if (Object.keys(genConfig).length > 0) result.generationConfig = genConfig;

    // Thinking: OpenAI-style reasoning_effort or Anthropic-style thinking →
    // Gemini thinkingConfig (if the model supports it)
    const thinkingBudget = body.thinking?.budget_tokens ?? body.thinking?.thinkingBudget;
    const effortBudgetMap: Record<string, number> = {
        low: 1024,
        medium: 4096,
        high: 8192,
        max: 16384,
    };
    const effortBudget = typeof body.reasoning_effort === "number"
        ? body.reasoning_effort
        : effortBudgetMap[body.reasoning_effort];
    const budget = thinkingBudget || effortBudget;
    if (body.thinking?.type === "enabled" || body.reasoning_effort) {
        const tc = result.generationConfig?.thinkingConfig || {};
        tc.includeThoughts = true;
        if (budget) tc.thinkingBudget = budget;
        result.generationConfig = result.generationConfig || {};
        result.generationConfig.thinkingConfig = tc;
    }

    return result;
}

/** Safe JSON.parse that returns fallback on failure */
function safeJsonParse(s: string): any {
    try {
        return JSON.parse(s);
    } catch {
        return {};
    }
}

/** Extract pure text content from a Gemini content/parts array */
function geminiTextFromParts(parts: Array<Record<string, any>>): string {
    return (parts || [])
        .filter((p: any) => p?.text)
        .map((p: any) => p.text)
        .join("");
}

/** Extract tool calls from Gemini candidate content parts (functionCall blocks) */
function geminiToolCalls(parts: Array<Record<string, any>>): Array<Record<string, any>> {
    const calls: Array<Record<string, any>> = [];
    (parts || []).forEach((p: any, idx: number) => {
        if (p?.functionCall) {
            calls.push({
                id: `call_${idx}`,
                type: "function",
                function: {
                    name: p.functionCall.name || "",
                    arguments: JSON.stringify(p.functionCall.args || {}),
                },
            });
        }
    });
    return calls;
}

/** Extract thinking text from Gemini candidate parts (thought=true) */
function geminiThoughtText(parts: Array<Record<string, any>>): string {
    return (parts || [])
        .filter((p: any) => p?.thought === true && p?.text)
        .map((p: any) => p.text)
        .join("");
}

/** Extract grounding citations from a Gemini candidate (groundingMetadata) */
function geminiGrounding(candidate: any): Array<Record<string, any>> {
    const meta = candidate?.groundingMetadata;
    if (!meta) return [];
    const citations: Array<Record<string, any>> = [];
    const chunks = meta.groundingChunks || [];
    for (let i = 0; i < chunks.length; i++) {
        const web = chunks[i]?.web;
        if (web?.uri) {
            citations.push({ index: i, uri: web.uri, title: web.title || "" });
        }
    }
    // fallback: groundingSupports provides indices into groundingChunks
    if (citations.length === 0 && meta.groundingSupports && Array.isArray(meta.groundingSupports)) {
        for (const sup of meta.groundingSupports) {
            const seg = sup?.segment || {};
            const idxs = (sup.groundingChunkIndices || []).filter((idx: number) => idx < chunks.length);
            for (const idx of idxs) {
                const web = chunks[idx]?.web;
                if (web?.uri) citations.push({ index: idx, uri: web.uri, title: web.title || "", segment: seg.text || "" });
            }
        }
    }
    return citations;
}

/**
 * Convert a Gemini non-stream generateContent response to OpenAI chat.completion format.
 * - content parts [] → choices[].message.content
 * - thought parts → message.reasoning_content
 * - functionCall parts → choices[].message.tool_calls
 * - groundingMetadata → message.metadata.grounding (citations)
 */
export function geminiToOpenAI(data: any, model: string): any {
    const candidate = data?.candidates?.[0] || {};
    const parts = candidate?.content?.parts || [];

    const textContent = geminiTextFromParts(parts);
    const toolCalls = geminiToolCalls(parts);
    const thinking = geminiThoughtText(parts);
    const grounding = geminiGrounding(candidate);

    const message: Record<string, any> = { role: "assistant", content: textContent || null };
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (thinking) message.reasoning_content = thinking;
    if (grounding.length > 0) {
        message.metadata = { grounding: { citations: grounding } };
    }

    const usage = data?.usageMetadata;
    return {
        id: data?.id || `chatcmpl-${crypto.randomUUID()}`,
        model,
        object: "chat.completion",
        choices: [{
            index: 0,
            message,
            finish_reason: candidate?.finishReason === "STOP" ? "stop"
                : candidate?.finishReason === "TOOL_CALL" || candidate?.finishReason === "FUNCTION_CALL" ? "tool_calls"
                : candidate?.finishReason?.toLowerCase?.() || "stop",
        }],
        usage: usage ? {
            prompt_tokens: usage.promptTokenCount ?? 0,
            completion_tokens: usage.candidatesTokenCount ?? 0,
            total_tokens: (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0),
            prompt_tokens_details: {
                cached_tokens: usage.cachedContentTokenCount ?? 0,
            },
        } : undefined,
    };
}

/**
 * Convert a Gemini streamGenerateContent SSE stream (alt=sse) to OpenAI SSE
 * chat.completion.chunk stream. Each Gemini SSE payload is a full candidate
 * snapshot, so we emit deltas by diffing consecutive text parts.
 *
 * Handles:
 *  - text parts → choices[].delta.content
 *  - thought=true parts → choices[].delta.reasoning_content
 *  - functionCall parts → choices[].delta.tool_calls (aggregated via fragments)
 *  - usageMetadata (last chunk) → top-level usage
 *  - finishReason STOP → finish_reason stop, then [DONE]
 */
export function geminiStreamToOpenAI(upstream: ReadableStream<Uint8Array>, model: string): ReadableStream<Uint8Array> {
    const ts = new TransformStream<Uint8Array, Uint8Array>();
    const writer = ts.writable.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    (async () => {
        try {
            const reader = upstream.getReader();
            let buffer = "";
            let prevText = "";
            let prevThought = "";
            let prevToolSignatures = new Set<string>();   // "name:argsLen" seen so far
            let sentRole = false;
            let finished = false;
            let finalUsage: any = null;

            function emit(chunk: Record<string, any>) {
                const payload = JSON.stringify(chunk);
                writer.write(encoder.encode(`data: ${payload}\n\n`));
            }

            function emitFinish(reason: string) {
                if (finished) return;
                finished = true;
                emit({
                    id: crypto.randomUUID(),
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model,
                    choices: [{ index: 0, delta: {}, finish_reason: reason }],
                });
                if (finalUsage) {
                    emit({
                        id: crypto.randomUUID(),
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model,
                        choices: [],
                        usage: {
                            prompt_tokens: finalUsage.promptTokenCount ?? 0,
                            completion_tokens: finalUsage.candidatesTokenCount ?? 0,
                            total_tokens: (finalUsage.promptTokenCount ?? 0) + (finalUsage.candidatesTokenCount ?? 0),
                            prompt_tokens_details: { cached_tokens: finalUsage.cachedContentTokenCount ?? 0 },
                        },
                    });
                }
                writer.write(encoder.encode("data: [DONE]\n\n"));
            }

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) continue;
                    const payload = trimmed.slice(5).trim();
                    if (!payload || payload === "[DONE]") continue;

                    try {
                        const data = JSON.parse(payload);
                        if (data.usageMetadata) finalUsage = data.usageMetadata;

                        const cand = data.candidates?.[0];
                        if (!cand) continue;

                        const parts = cand.content?.parts || [];
                        const text = parts.filter((p: any) => p?.text && p?.thought !== true).map((p: any) => p.text).join("");
                        const thought = parts.filter((p: any) => p?.thought === true && p?.text).map((p: any) => p.text).join("");
                        const toolCalls: Array<any> = [];
                        parts.forEach((p: any, idx: number) => {
                            if (p?.functionCall) {
                                toolCalls.push({
                                    index: idx,
                                    id: `call_${idx}`,
                                    type: "function",
                                    function: {
                                        name: p.functionCall.name || "",
                                        arguments: JSON.stringify(p.functionCall.args || {}),
                                    },
                                });
                            }
                        });

                        const delta: Record<string, any> = {};
                        if (!sentRole) {
                            delta.role = "assistant";
                            sentRole = true;
                        }

                        // Text delta (diff against previous snapshot)
                        if (text.length > prevText.length) {
                            delta.content = text.slice(prevText.length);
                        } else if (text.length < prevText.length) {
                            // Reset (new candidate snapshot) — emit full text
                            delta.content = text;
                        }
                        prevText = text;

                        // Thought delta
                        if (thought.length > prevThought.length) {
                            delta.reasoning_content = thought.slice(prevThought.length);
                        } else if (thought.length < prevThought.length) {
                            delta.reasoning_content = thought;
                        }
                        prevThought = thought;

                        // Tool calls: emit any newly-seen functionCall (by name+args signature)
                        if (toolCalls.length > 0) {
                            const newCalls: Array<any> = [];
                            for (const c of toolCalls) {
                                const sig = `${c.function.name}:${c.function.arguments.length}`;
                                if (!prevToolSignatures.has(sig)) {
                                    prevToolSignatures.add(sig);
                                    newCalls.push(c);
                                }
                            }
                            if (newCalls.length > 0) delta.tool_calls = newCalls;
                        }
                        prevToolSignatures = new Set(
                            [...prevToolSignatures].filter(sig => toolCalls.some((c: any) => `${c.function.name}:${c.function.arguments.length}` === sig)),
                        );

                        // Grounding citations on the last chunk with metadata
                        if (cand.groundingMetadata) {
                            const grounding = geminiGrounding(cand);
                            if (grounding.length > 0) {
                                delta.metadata = { grounding: { citations: grounding } };
                            }
                        }

                        const hasContent = delta.content !== undefined || delta.reasoning_content !== undefined || delta.tool_calls !== undefined;
                        if (hasContent) {
                            emit({
                                id: crypto.randomUUID(),
                                object: "chat.completion.chunk",
                                created: Math.floor(Date.now() / 1000),
                                model,
                                choices: [{ index: 0, delta, finish_reason: null }],
                            });
                        }

                        if (cand.finishReason) {
                            const reason = cand.finishReason === "STOP" ? "stop"
                                : cand.finishReason === "TOOL_CALL" || cand.finishReason === "FUNCTION_CALL" ? "tool_calls"
                                : cand.finishReason?.toLowerCase?.() || "stop";
                            emitFinish(reason);
                        }
                    } catch { }
                }
            }

            if (!finished) emitFinish("stop");
            await writer.close();
        } catch {
            try { await writer.close(); } catch { }
        }
    })();

    return ts.readable;
}