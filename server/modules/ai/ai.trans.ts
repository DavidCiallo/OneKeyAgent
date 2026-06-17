/**
 * AI protocol conversion utilities: OpenAI ↔ Anthropic format interchange
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
            let hasTextContent = false;
            let hasToolCalls = false;
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
                                hasTextContent = true;
                                if (!textBlockStarted) {
                                    await emitContentBlockStart(textBlockIndex, { type: "text", text: content });
                                    textBlockStarted = true;
                                } else {
                                    await emitContentBlockDelta(textBlockIndex, { type: "text_delta", text: content });
                                }
                            }

                            // Tool calls handling
                            if (toolCalls && Array.isArray(toolCalls)) {
                                hasToolCalls = true;
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