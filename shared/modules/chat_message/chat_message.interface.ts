import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { ChatMessageEntity } from "./chat_message.entity";

// DTO
export class ChatMessageDTO {
    public id: string;
    public session_id: string;
    public role: string;
    public content: string;
    public create_time: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: ChatMessageEntity) {
        this.id = origin.id;
        this.session_id = origin.session_id;
        this.role = origin.role;
        this.content = origin.content;
        this.create_time = origin.create_time;
    }
}

// ---- Message List ----
export class ChatMessageListRequest implements BaseRequest {
    public auth?: string;
    public session_id: string;

    constructor(origin: Partial<ChatMessageListRequest>) {
        if (!origin.session_id) throw new Error("Session id is required");
        origin.auth && (this.auth = origin.auth);
        this.session_id = origin.session_id;
    }
    static self(unsafe: ChatMessageListRequest) {
        return new ChatMessageListRequest(unsafe);
    }
}

export class ChatMessageListResponse implements BaseResponse<ChatMessageDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: ChatMessageDTO[]
    };

    constructor(origin: ChatMessageListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// ---- Message Send ----
export class ChatMessageSendRequest implements BaseRequest {
    public auth?: string;
    public session_id: string;
    public content: string;

    constructor(origin: Partial<ChatMessageSendRequest>) {
        if (!origin.session_id) throw new Error("Session id is required");
        if (!origin.content) throw new Error("Content is required");
        origin.auth && (this.auth = origin.auth);
        this.session_id = origin.session_id;
        this.content = origin.content;
    }
    static self(unsafe: ChatMessageSendRequest) {
        return new ChatMessageSendRequest(unsafe);
    }
}

export class ChatMessageSendResponse implements BaseResponse<ChatMessageDTO> {
    public success: boolean;
    public message: string;
    public data: {
        message: ChatMessageDTO | null
    };

    constructor(origin: ChatMessageSendResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}