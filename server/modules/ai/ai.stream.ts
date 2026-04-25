/**
 * 将完整的非流式响应内容，模拟成 SSE 流式传输的 ReadableStream
 * 格式兼容 OpenAI 的 streaming API
 */
export function createPseudoStream(
    content: string,
    id: string,
    model: string,
    created: number,
    chunkDelayMs: number = 30,
): ReadableStream<Uint8Array> {
    return new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            const roleChunk = {
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                    {
                        index: 0,
                        delta: { role: "assistant", content: "" },
                        finish_reason: null,
                    },
                ],
            };
            controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`),
            );

            for (let i = 0; i < content.length; i++) {
                const chunk = content[i];
                const contentChunk = {
                    id,
                    object: "chat.completion.chunk",
                    created,
                    model,
                    choices: [
                        {
                            index: 0,
                            delta: { content: chunk },
                            finish_reason: null,
                        },
                    ],
                };
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(contentChunk)}\n\n`),
                );
                await new Promise((resolve) =>
                    setTimeout(resolve, chunkDelayMs),
                );
            }

            const finishChunk = {
                id,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [
                    {
                        index: 0,
                        delta: {},
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

/**
 * 为 completions endpoint 生成伪流式
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