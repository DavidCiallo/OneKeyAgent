import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const chatMessageTable = sqliteTable("chat_message", {
    id: text("id").primaryKey(),
    session_id: text("session_id").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});