export interface ModelEntity {
    id: string;
    tier: number;
    baseURL: string;
    model: string;
    apiKey?: string;
    proxyURL?: string;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}

export interface AiSessionEntity {
    id: string;
    apiKey: string;
    modelId: string;
    context: string;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}

export interface UsageLogEntity {
    id: string;
    apiKey: string;
    sessionId: string;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}