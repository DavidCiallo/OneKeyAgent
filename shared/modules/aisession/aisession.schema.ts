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