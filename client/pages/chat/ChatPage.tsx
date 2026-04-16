import { Header } from "../../components/header/Header";
import { useEffect, useState, useCallback, useRef } from "react";
import { ChatSessionRouter, ChatMessageRouter } from "../../api/instance";
import { Locale } from "../../methods/locale";
import { ChatSessionDTO } from "../../../shared/modules/chat_session/chat_session.interface";
import { ChatMessageDTO } from "../../../shared/modules/chat_message/chat_message.interface";
import { ChatSessionListRequest, ChatSessionCreateRequest, ChatSessionDeleteRequest } from "../../../shared/modules/chat_session/chat_session.interface";
import { ChatMessageListRequest, ChatMessageSendRequest } from "../../../shared/modules/chat_message/chat_message.interface";
import { Button } from "@heroui/react";

export default function ChatPage() {
    const locale = Locale("ChatPage");
    const menuLocale = Locale("Menu");
    const getToken = () => localStorage.getItem("access_token") || "";

    const [sessions, setSessions] = useState<ChatSessionDTO[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessageDTO[]>([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);

    const messageEndRef = useRef<HTMLDivElement>(null);

    const fetchSessions = useCallback(async () => {
        const res = await ChatSessionRouter.list(new ChatSessionListRequest({ auth: getToken() }));
        if (res.success && res.data) {
            setSessions(res.data.list);
        }
    }, []);

    const fetchMessages = useCallback(async (sessionId: string) => {
        const res = await ChatMessageRouter.list(new ChatMessageListRequest({ session_id: sessionId, auth: getToken() }));
        if (res.success && res.data) {
            setMessages(res.data.list);
        }
    }, []);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

    useEffect(() => {
        if (activeSessionId) {
            fetchMessages(activeSessionId);
        } else {
            setMessages([]);
        }
    }, [activeSessionId, fetchMessages]);

    useEffect(() => {
        messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    const handleNewChat = async () => {
        const res = await ChatSessionRouter.create(new ChatSessionCreateRequest({ auth: getToken() }));
        if (res.success && res.data?.session) {
            await fetchSessions();
            setActiveSessionId(res.data.session.id);
        }
    };

    const handleDelete = async (sessionId: string) => {
        if (!window.confirm(locale.DeleteConfirm)) return;
        await ChatSessionRouter.delete(new ChatSessionDeleteRequest({ id: sessionId, auth: getToken() }));
        if (activeSessionId === sessionId) {
            setActiveSessionId(null);
            setMessages([]);
        }
        await fetchSessions();
    };

    const handleSend = async () => {
        if (!input.trim() || !activeSessionId || loading) return;
        const content = input.trim();
        setInput("");
        setLoading(true);

        // Optimistically add user message
        const tempUserMsg: ChatMessageDTO = {
            id: "temp-" + Date.now(),
            session_id: activeSessionId,
            role: "user",
            content,
            create_time: Date.now(),
        } as ChatMessageDTO;
        setMessages(prev => [...prev, tempUserMsg]);

        try {
            const res = await ChatMessageRouter.send(new ChatMessageSendRequest({
                session_id: activeSessionId,
                content,
                auth: getToken(),
            }));
            if (res.success && res.data?.message) {
                // Replace optimistic messages with real data
                await fetchMessages(activeSessionId);
            }
        } catch (e) {
            console.error("Send failed:", e);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="max-w-screen flex flex-col h-screen">
            <Header name={menuLocale.Chat} />
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                <div className="w-64 border-r border-gray-200 flex flex-col bg-gray-50">
                    <div className="p-3">
                        <Button
                            onClick={handleNewChat}
                            color="primary"
                            className="w-full py-2 px-4 text-white text-sm font-medium"
                        >
                            + {locale.NewChat}
                        </Button>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        {sessions.map(session => (
                            <div
                                key={session.id}
                                className={`px-4 py-4 cursor-pointer flex items-center justify-between group hover:bg-gray-100 transition-colors ${activeSessionId === session.id ? "bg-primary-50 border-r-2 border-primary-500" : ""}`}
                                onClick={() => setActiveSessionId(session.id)}
                            >
                                <span className="text-sm truncate flex-1 mr-2">{session.title}</span>
                                <span
                                    onClick={(e) => { e.stopPropagation(); handleDelete(session.id); }}
                                    className="text-xs text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    {locale.DeleteChat}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Main chat area */}
                <div className="flex-1 flex flex-col">
                    {activeSessionId ? (
                        <>
                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4 mt-10">
                                {messages.map(msg => (
                                    <div
                                        key={msg.id}
                                        className={`flex w-[95%] mx-auto ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                                    >
                                        <div
                                            className={`max-w-[80%] px-4 py-2 rounded-2xl text-sm leading-relaxed ${
                                                msg.role === "user"
                                                    ? "bg-primary-500 text-white"
                                                    : "bg-gray-100 text-gray-800"
                                            }`}
                                        >
                                            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                                        </div>
                                    </div>
                                ))}
                                {loading && (
                                    <div className="flex justify-start w-[95%] mx-auto">
                                        <div className="bg-gray-100 text-gray-500 px-4 py-4 rounded-2xl text-sm">
                                            <div className="flex items-center gap-1">
                                                <span className="animate-bounce inline-block w-1.5 h-1.5 bg-gray-400 rounded-full" style={{ animationDelay: "0ms" }}></span>
                                                <span className="animate-bounce inline-block w-1.5 h-1.5 bg-gray-400 rounded-full" style={{ animationDelay: "150ms" }}></span>
                                                <span className="animate-bounce inline-block w-1.5 h-1.5 bg-gray-400 rounded-full" style={{ animationDelay: "300ms" }}></span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div ref={messageEndRef} />
                            </div>

                            {/* Input */}
                            <div className="border-t border-gray-200 p-4">
                                <div className="flex gap-2">
                                    <textarea
                                        value={input}
                                        onChange={e => setInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        placeholder={locale.Placeholder}
                                        disabled={loading}
                                        rows={1}
                                        className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400 disabled:opacity-50"
                                    />
                                    <button
                                        onClick={handleSend}
                                        disabled={loading || !input.trim()}
                                        className="px-5 py-2.5 bg-primary-500 text-white rounded-xl hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                                    >
                                        {locale.Send}
                                    </button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">
                            {locale.NoSession}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}