import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { Message } from "./ai.interface";

/* ========== Ollama Chat ========== */

export class OllamaChatRequest implements BaseRequest {
    public model: string;
    public messages: Message[];
    public stream?: boolean;
    public options?: {
        temperature?: number;
        num_predict?: number;
        top_k?: number;
        top_p?: number;
    };
    public auth?: string;

    constructor(data: any) {
        if (!data.model || !data.messages) throw new Error("Model and messages are required");
        this.model = data.model;
        this.messages = data.messages.map((m: any) => Message.self(m));
        this.stream = data.stream;
        this.options = data.options;
        this.auth = data.auth;
    }

    static self(data: any): OllamaChatRequest {
        return new OllamaChatRequest(data);
    }
}

export class OllamaChatResponse implements BaseResponse<Message> {
    success: boolean;
    id: string;
    object: string = "chat.completion";
    created: number;
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
    message?: string;

    constructor(data: {
        id: string;
        model: string;
        choices: Array<{
            index: number;
            message: { role: string; content: string };
            finish_reason: string;
        }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    }) {
        this.success = true;
        this.id = data.id;
        this.created = Date.now();
        this.model = data.model;
        this.choices = data.choices.map(c => ({
            ...c,
            message: new Message(c.message),
        }));
        this.usage = data.usage;
    }
}

/* ========== Ollama Generate ========== */

export class OllamaGenerateRequest implements BaseRequest {
    public model: string;
    public prompt: string;
    public stream?: boolean;
    public options?: {
        temperature?: number;
        num_predict?: number;
        top_k?: number;
        top_p?: number;
    };
    public auth?: string;

    constructor(data: any) {
        if (!data.model || !data.prompt) throw new Error("Model and prompt are required");
        this.model = data.model;
        this.prompt = data.prompt;
        this.stream = data.stream;
        this.options = data.options;
        this.auth = data.auth;
    }

    static self(data: any): OllamaGenerateRequest {
        return new OllamaGenerateRequest(data);
    }
}

export class OllamaGenerateResponse implements BaseResponse<any> {
    success: boolean;
    model: string;
    created_at: string;
    response: string;
    done: boolean;
    done_reason: string;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    message?: string;

    constructor(data: {
        model: string;
        choices: Array<{ text: string; finish_reason: string }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    }) {
        this.success = true;
        this.model = data.model;
        this.created_at = new Date().toISOString();
        this.response = data.choices?.[0]?.text || "";
        this.done = true;
        this.done_reason = data.choices?.[0]?.finish_reason || "stop";
        this.usage = data.usage;
    }
}

/* ========== Ollama Tags (List Models) ========== */

export class OllamaTagsRequest implements BaseRequest {
    public auth?: string;

    constructor(data: any) {
        this.auth = data.auth;
    }

    static self(data: any): OllamaTagsRequest {
        return new OllamaTagsRequest(data);
    }
}

export interface OllamaModelEntry {
    name: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
        format: string;
        family: string;
        parameter_size: string;
        quantization_level: string;
    };
}

export class OllamaTagsResponse implements BaseResponse<any> {
    success: boolean;
    object: string = "list";
    data: Array<{
        id: string;
        object: string;
        created: number;
        owned_by: string;
    }>;
    message?: string;

    constructor(data: { data: Array<{ id: string; object: string; created: number; owned_by: string }> }) {
        this.success = true;
        this.data = data.data;
    }
}
