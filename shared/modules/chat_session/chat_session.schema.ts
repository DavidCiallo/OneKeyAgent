import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const chatSessionTable = sqliteTable("chat_session", {
    id: text("id").primaryKey(),
    user_id: text("user_id").notNull(),
    title: text("title").notNull().default("New Chat"),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});