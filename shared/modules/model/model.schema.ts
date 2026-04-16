import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const modelTable = sqliteTable("model", {
    id: text("id").primaryKey(),
    tier: integer("tier").notNull(),
    baseURL: text("base_url").notNull(),
    model: text("model").notNull(),
    alias: text("alias"),
    apiKey: text("api_key"),
    proxyURL: text("proxy_url"),
    create_time: integer("create_time"),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});