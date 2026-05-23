import {
    ChatCompletionsRequest,
    ChatCompletionsResponse,
    CompletionRequest,
    CompletionResponse,
    ModelsRequest,
    ModelsResponse,
} from "./ai.interface";

export const aiRoutes = {
    base: "/api",
    prefix: "",
    chatcompletions: { path: "/chat/completions", request: {} as ChatCompletionsRequest, response: {} as ChatCompletionsResponse, raw: true },
    completions:     { path: "/completions",      request: {} as CompletionRequest,      response: {} as CompletionResponse,      raw: true },
    models:          { path: "/models",           request: {} as ModelsRequest,           response: {} as ModelsResponse,          raw: true },
    v1messages:      { path: "/v1/messages",      request: {} as any,                     response: {} as any,                     raw: true },
} as const;
