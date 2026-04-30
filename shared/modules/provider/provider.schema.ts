import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const providerTable = sqliteTable("provider", {
    id: text("id").primaryKey(),
    modelAlias: text("model_alias").notNull(),
    priority: integer("priority").notNull().default(1),
    name: text("name").notNull().default(""),
    baseURL: text("base_url").notNull(),
    model: text("model").notNull(),
    apiKey: text("api_key"),
    proxyURL: text("proxy_url"),
    enabled: integer("enabled").notNull().default(1),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});
