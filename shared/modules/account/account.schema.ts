import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const accountTable = sqliteTable("account", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    password: text("password").notNull(),
    apiKey: text("api_key"),
    is_admin: integer("is_admin").notNull().default(0),
    monthly_limit: integer("monthly_limit").notNull().default(10000000),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});