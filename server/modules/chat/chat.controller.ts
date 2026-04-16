import {
    ChatSessionListRequest,
    ChatSessionListResponse,
    ChatSessionCreateRequest,
    ChatSessionCreateResponse,
    ChatSessionDeleteRequest,
    ChatSessionDeleteResponse,
} from "../../../shared/modules/chat_session/chat_session.interface";
import {
    ChatMessageListRequest,
    ChatMessageListResponse,
    ChatMessageSendRequest,
    ChatMessageSendResponse,
} from "../../../shared/modules/chat_message/chat_message.interface";
import { ChatSessionRouterInstance } from "../../../shared/modules/chat_session/chat_session.router";
import { ChatMessageRouterInstance } from "../../../shared/modules/chat_message/chat_message.router";
import { inject } from "../../lib/inject";
import { ChatSessionService, ChatMessageService } from "./chat.service";
import { getIdentifyByVerify } from "../auth/auth.service";

function getEmail(auth?: string): string {
    if (!auth) throw new Error("Unauthorized");
    const email = getIdentifyByVerify(auth);
    if (!email) throw new Error("Unauthorized");
    return email;
}

// Session routes
async function sessionList(request: ChatSessionListRequest): Promise<ChatSessionListResponse> {
    const email = getEmail(request.auth);
    const list = await ChatSessionService.list(email);
    return new ChatSessionListResponse({ success: true, message: "OK", data: { list } });
}

async function sessionCreate(request: ChatSessionCreateRequest): Promise<ChatSessionCreateResponse> {
    const email = getEmail(request.auth);
    const session = await ChatSessionService.create(email);
    return new ChatSessionCreateResponse({ success: true, message: "OK", data: { session } });
}

async function sessionDelete(request: ChatSessionDeleteRequest): Promise<ChatSessionDeleteResponse> {
    request = ChatSessionDeleteRequest.self(request);
    const email = getEmail(request.auth);
    await ChatSessionService.delete(request.id);
    return new ChatSessionDeleteResponse({ success: true, message: "OK" });
}

// Message routes
async function messageList(request: ChatMessageListRequest): Promise<ChatMessageListResponse> {
    request = ChatMessageListRequest.self(request);
    const list = await ChatMessageService.list(request.session_id);
    return new ChatMessageListResponse({ success: true, message: "OK", data: { list } });
}

async function messageSend(request: ChatMessageSendRequest): Promise<ChatMessageSendResponse> {
    request = ChatMessageSendRequest.self(request);
    const email = getEmail(request.auth);
    const message = await ChatMessageService.send(email, request.session_id, request.content, request.auth || "");
    return new ChatMessageSendResponse({ success: true, message: "OK", data: { message } });
}

export const chatSessionController = new ChatSessionRouterInstance(inject, {
    list: sessionList,
    create: sessionCreate,
    delete: sessionDelete,
});

export const chatMessageController = new ChatMessageRouterInstance(inject, {
    list: messageList,
    send: messageSend,
});