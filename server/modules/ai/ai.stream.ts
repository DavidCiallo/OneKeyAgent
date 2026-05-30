function sendChunk(
    controller: ReadableStreamController<Uint8Array>,
    encoder: TextEncoder,
    id: string,
    model: string,
    created: number,
    choices: Array<{
        index: number;
        delta: Record<string, any>;
        finish_reason: string | null;
    }>,
) {
    const chunk = {
        id,
        object: "chat.completion.chunk" as const,
        created,
        model,
        choices,
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
}

/**
 * Convert a complete non-streaming response (possibly with tool_calls) into an SSE streaming ReadableStream.
 * Compatible with OpenAI's streaming API format, including tool_calls chunking.
 */
export function createPseudoStream(
    content: string,
    id: string,
    model: string,
    created: number,
    toolCalls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
    }>,
): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            // role chunk
            sendChunk(controller, encoder, id, model, created, [
                { index: 0, delta: { role: "assistant", content: toolCalls ? null : "" }, finish_reason: null },
            ]);

            // Emit all tool_calls at once
            if (toolCalls && toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    sendChunk(controller, encoder, id, model, created, [
                        {
                            index: 0,
                            delta: {
                                tool_calls: [
                                    { index: 0, id: tc.id, type: tc.type, function: { name: tc.function.name, arguments: tc.function.arguments } },
                                ],
                            },
                            finish_reason: null,
                        },
                    ]);
                }
            }

            // Emit all content at once (only when there are no tool_calls)
            if (!toolCalls || toolCalls.length === 0) {
                sendChunk(controller, encoder, id, model, created, [
                    { index: 0, delta: { content }, finish_reason: null },
                ]);
            }

            // finish chunk
            sendChunk(controller, encoder, id, model, created, [
                { index: 0, delta: {}, finish_reason: "stop" },
            ]);

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
        },
    });
}

/**
 * Create a pseudo-stream for the completions endpoint
 */
export function createPseudoCompletionStream(
    text: string,
    id: string,
    model: string,
    created: number,
    chunkDelayMs: number = 30,
): ReadableStream<Uint8Array> {
    return new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();

            for (let i = 0; i < text.length; i++) {
                const chunk = {
                    id,
                    object: "text_completion",
                    created,
                    model,
                    choices: [
                        {
                            index: 0,
                            text: text[i],
                            finish_reason: null,
                        },
                    ],
                };
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
                );
                await new Promise((resolve) =>
                    setTimeout(resolve, chunkDelayMs),
                );
            }

            const finishChunk = {
                id,
                object: "text_completion",
                created,
                model,
                choices: [
                    {
                        index: 0,
                        text: "",
                        finish_reason: "stop",
                    },
                ],
            };
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`),
            );
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
        },
    });
}