import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    ChatCompletionsRequest,
    ChatCompletionsResponse,
    CompletionRequest,
    CompletionResponse,
    ModelsRequest,
    ModelsResponse,
} from "./ai.interface";

export class AiRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "";
    router = [
        { path: "/chat/completions", handler: Function },
        { path: "/completions", handler: Function },
        { path: "/models", handler: Function },
    ];

    chatcompletions!: (request: ChatCompletionsRequest) => Promise<ChatCompletionsResponse>;
    completion!: (request: CompletionRequest) => Promise<CompletionResponse>;
    models!: (request: ModelsRequest) => Promise<ModelsResponse>;

    constructor(
        inject: Function,
        functions?: {
            chatcompletions: (request: ChatCompletionsRequest) => Promise<ChatCompletionsResponse>;
            completions: (request: CompletionRequest) => Promise<CompletionResponse>;
            models: (request: ModelsRequest) => Promise<ModelsResponse>;
        }
    ) {
        super();
        inject(this, functions);
    }
}

export class AiOldRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/v1";
    router = [
        { path: "/chat/completions", handler: Function },
        { path: "/completions", handler: Function },
        { path: "/models", handler: Function },
    ];

    chatcompletions!: (request: ChatCompletionsRequest) => Promise<ChatCompletionsResponse>;
    completion!: (request: CompletionRequest) => Promise<CompletionResponse>;
    models!: (request: ModelsRequest) => Promise<ModelsResponse>;

    constructor(
        inject: Function,
        functions?: {
            chatcompletions: (request: ChatCompletionsRequest) => Promise<ChatCompletionsResponse>;
            completions: (request: CompletionRequest) => Promise<CompletionResponse>;
            models: (request: ModelsRequest) => Promise<ModelsResponse>;
        }
    ) {
        super();
        inject(this, functions);
    }
}