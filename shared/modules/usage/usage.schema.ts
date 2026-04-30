import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const usageLogTable = sqliteTable("usage_log", {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    modelAlias: text("model_alias").notNull(),
    providerId: text("provider_id").default(""),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    create_time: integer("create_time"),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});
