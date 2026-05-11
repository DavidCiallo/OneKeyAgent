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
        { path: "/v1/messages", handler: Function },
    ];

    chatcompletions!: (request: ChatCompletionsRequest) => Promise<ChatCompletionsResponse>;
    completion!: (request: CompletionRequest) => Promise<CompletionResponse>;
    models!: (request: ModelsRequest) => Promise<ModelsResponse>;
    v1messages!: (request: any) => Promise<any>;

    constructor(
        inject: Function,
        functions?: {
            chatcompletions: (request: ChatCompletionsRequest) => Promise<ChatCompletionsResponse>;
            completions: (request: CompletionRequest) => Promise<CompletionResponse>;
            models: (request: ModelsRequest) => Promise<ModelsResponse>;
            v1messages?: (request: any) => Promise<any>;
        }
    ) {
        super();
        inject(this, functions);
    }
}