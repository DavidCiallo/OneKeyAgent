import { BaseRequest, BaseResponse } from "../../lib/default/decorator";

export class Message {
    role: "system" | "user" | "assistant";
    content: string;

    constructor(origin: Pick<Message, "role" | "content">) {
        this.role = origin.role;
        this.content = origin.content;
    }

    static self(unsafe: any): Message {
        return new Message(unsafe);
    }
}

export class ChatCompletionsRequest implements BaseRequest {
    public model: string;
    public messages: Message[];
    public temperature?: number;
    public max_tokens?: number;
    public stream?: boolean;
    public auth?: string;

    constructor(data: any) {
        if (!data.model || !data.messages) throw new Error("Model and messages are required");
        this.model = data.model;
        this.messages = data.messages.map((m: any) => Message.self(m));
        this.temperature = data.temperature;
        this.max_tokens = data.max_tokens;
        this.stream = data.stream;
        this.auth = data.auth;
    }

    static self(data: any): ChatCompletionsRequest {
        return new ChatCompletionsRequest(data);
    }
}

export class CompletionRequest implements BaseRequest {
    public model: string;
    public prompt: string;
    public temperature?: number;
    public max_tokens?: number;
    public stream?: boolean;
    public auth?: string;

    constructor(data: any) {
        if (!data.model || !data.prompt) throw new Error("Model and prompt are required");
        this.model = data.model;
        this.prompt = data.prompt;
        this.temperature = data.temperature;
        this.max_tokens = data.max_tokens;
        this.stream = data.stream;
        this.auth = data.auth;
    }

    static self(data: any): CompletionRequest {
        return new CompletionRequest(data);
    }
}

export class ModelsRequest implements BaseRequest {
    public auth?: string;

    constructor(data: any) {
        this.auth = data.auth;
    }

    static self(data: any): ModelsRequest {
        return new ModelsRequest(data);
    }
}


export interface ChatCompletionsServiceResponse {
    id: string;
    model: string;
    choices: Array<{
        index: number;
        message: Message;
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface CompletionServiceResponse {
    id: string;
    model: string;
    choices: Array<{
        index: number;
        text: string;
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface ModelsServiceResponse {
    data: Array<{
        id: string;
        object: string;
        created: number;
        owned_by: string;
    }>;
}

export class CompletionResponse implements BaseResponse<string> {
    success: boolean;
    id: string;
    object: string = "text_completion";
    created: number;
    model: string;
    choices: Array<{
        index: number;
        text: string;
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    message?: string;

    constructor(data: CompletionServiceResponse) {
        this.success = true;
        this.id = data.id;
        this.created = Date.now();
        this.model = data.model;
        this.choices = data.choices;
        this.usage = data.usage;
    }
}

export class ModelsResponse implements BaseResponse<any> {
    success: boolean;
    object: string = "list";
    data: Array<{
        id: string;
        object: string;
        created: number;
        owned_by: string;
    }>;
    message?: string;

    constructor(data: ModelsServiceResponse) {
        this.success = true;
        this.data = data.data;
    }
}

export interface AiService {
    chatCompletions: (request: ChatCompletionsRequest) => Promise<CompletionResponse>;
    completions: (request: CompletionRequest) => Promise<CompletionResponse>;
    listModels: (request: ModelsRequest) => Promise<ModelsResponse>;
}