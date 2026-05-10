import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const accountTable = sqliteTable("account", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    password: text("password").notNull(),
    apiKey: text("api_key"),
    is_admin: integer("is_admin").notNull().default(0),
    plan: text("plan").notNull().default("free"),
    plan_expires_at: integer("plan_expires_at"),
    sub_wallet_address: text("sub_wallet_address"),
    tg_chat_id: text("tg_chat_id"),
    topup_tokens: integer("topup_tokens").notNull().default(0),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});