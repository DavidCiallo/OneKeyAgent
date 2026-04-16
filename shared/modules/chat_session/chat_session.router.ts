import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    ChatSessionListRequest,
    ChatSessionListResponse,
    ChatSessionCreateRequest,
    ChatSessionCreateResponse,
    ChatSessionDeleteRequest,
    ChatSessionDeleteResponse,
} from "./chat_session.interface";

export class ChatSessionRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/chat/session";
    router = [
        { path: "/list", handler: Function },
        { path: "/create", handler: Function },
        { path: "/delete", handler: Function },
    ];

    list!: (request: ChatSessionListRequest) => Promise<ChatSessionListResponse>;
    create!: (request: ChatSessionCreateRequest) => Promise<ChatSessionCreateResponse>;
    delete!: (request: ChatSessionDeleteRequest) => Promise<ChatSessionDeleteResponse>;

    constructor(inject: Function, functions?: {
        list: (request: ChatSessionListRequest) => Promise<ChatSessionListResponse>,
        create: (request: ChatSessionCreateRequest) => Promise<ChatSessionCreateResponse>,
        delete: (request: ChatSessionDeleteRequest) => Promise<ChatSessionDeleteResponse>,
    }) {
        super();
        inject(this, functions);
    }
}