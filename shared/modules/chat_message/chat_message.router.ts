import { BaseRouterInstance } from "../../lib/default/decorator";
import {
    ChatMessageListRequest,
    ChatMessageListResponse,
    ChatMessageSendRequest,
    ChatMessageSendResponse,
} from "./chat_message.interface";

export class ChatMessageRouterInstance extends BaseRouterInstance {
    base = "/api";
    prefix = "/chat/message";
    router = [
        { path: "/list", handler: Function },
        { path: "/send", handler: Function },
    ];

    list!: (request: ChatMessageListRequest) => Promise<ChatMessageListResponse>;
    send!: (request: ChatMessageSendRequest) => Promise<ChatMessageSendResponse>;

    constructor(inject: Function, functions?: {
        list: (request: ChatMessageListRequest) => Promise<ChatMessageListResponse>,
        send: (request: ChatMessageSendRequest) => Promise<ChatMessageSendResponse>,
    }) {
        super();
        inject(this, functions);
    }
}