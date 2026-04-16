import { BaseRequest, BaseResponse } from "../../lib/default/decorator";
import { ChatSessionEntity } from "./chat_session.entity";

// DTO
export class ChatSessionDTO {
    public id: string;
    public user_id: string;
    public title: string;
    public create_time: number;

    private isTypeSafe: symbol = Symbol();

    constructor(origin: ChatSessionEntity) {
        this.id = origin.id;
        this.user_id = origin.user_id;
        this.title = origin.title;
        this.create_time = origin.create_time;
    }
}

// ---- Session List ----
export class ChatSessionListRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<ChatSessionListRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: ChatSessionListRequest) {
        return new ChatSessionListRequest(unsafe);
    }
}

export class ChatSessionListResponse implements BaseResponse<ChatSessionDTO> {
    public success: boolean;
    public message: string;
    public data: {
        list: ChatSessionDTO[]
    };

    constructor(origin: ChatSessionListResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// ---- Session Create ----
export class ChatSessionCreateRequest implements BaseRequest {
    public auth?: string;

    constructor(origin: Partial<ChatSessionCreateRequest>) {
        if (false) throw new Error("Unexpected error");
        origin.auth && (this.auth = origin.auth);
    }
    static self(unsafe: ChatSessionCreateRequest) {
        return new ChatSessionCreateRequest(unsafe);
    }
}

export class ChatSessionCreateResponse implements BaseResponse<ChatSessionDTO> {
    public success: boolean;
    public message: string;
    public data: {
        session: ChatSessionDTO | null
    };

    constructor(origin: ChatSessionCreateResponse) {
        this.success = origin.success;
        this.message = origin.message;
        this.data = origin.data;
    }
}

// ---- Session Delete ----
export class ChatSessionDeleteRequest implements BaseRequest {
    public auth?: string;
    public id: string;

    constructor(origin: Partial<ChatSessionDeleteRequest>) {
        if (!origin.id) throw new Error("Session id is required");
        origin.auth && (this.auth = origin.auth);
        this.id = origin.id;
    }
    static self(unsafe: ChatSessionDeleteRequest) {
        return new ChatSessionDeleteRequest(unsafe);
    }
}

export class ChatSessionDeleteResponse implements BaseResponse<ChatSessionDTO> {
    public success: boolean;
    public message: string;

    constructor(origin: ChatSessionDeleteResponse) {
        this.success = origin.success;
        this.message = origin.message;
    }
}