export interface AiSessionEntity {
    id: string;
    apiKey: string;
    modelId: string;
    context: string;
    create_time: number;
    update_time: number;
    delete_time: number | null;
}