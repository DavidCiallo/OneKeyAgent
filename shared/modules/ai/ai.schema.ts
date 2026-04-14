import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const aiSessionTable = sqliteTable("ai_session", {
    id: text("id").primaryKey(),
    apiKey: text("api_key").notNull(),
    modelId: text("model_id").notNull(),
    context: text("context").notNull(), // 存储为 JSON 字符串
    create_time: integer("create_time"),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});

export const usageLogTable = sqliteTable("usage_log", {
    id: text("id").primaryKey(),
    apiKey: text("api_key").notNull(),
    sessionId: text("session_id").notNull(),
    modelId: text("model_id").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    create_time: integer("create_time"),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});
