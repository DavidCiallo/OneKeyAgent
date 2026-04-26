import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    OllamaChatRequest,
    OllamaChatResponse,
    OllamaGenerateRequest,
    OllamaGenerateResponse,
    OllamaTagsRequest,
    OllamaTagsResponse,
} from "./ai.ollama.interface";

export class AiOllamaRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/api";
    router = [
        { path: "/chat", handler: Function },
        { path: "/generate", handler: Function },
        { path: "/tags", handler: Function },
    ];

    chat!: (request: OllamaChatRequest) => Promise<OllamaChatResponse>;
    generate!: (request: OllamaGenerateRequest) => Promise<OllamaGenerateResponse>;
    tags!: (request: OllamaTagsRequest) => Promise<OllamaTagsResponse>;

    constructor(
        inject: Function,
        functions?: {
            chat: (request: OllamaChatRequest) => Promise<OllamaChatResponse>;
            generate: (request: OllamaGenerateRequest) => Promise<OllamaGenerateResponse>;
            tags: (request: OllamaTagsRequest) => Promise<OllamaTagsResponse>;
        }
    ) {
        super();
        inject(this, functions);
    }
}
