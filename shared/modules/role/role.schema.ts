import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const roleTable = sqliteTable("role", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});

export const accountRoleTable = sqliteTable("account_role", {
    id: text("id").primaryKey(),
    account_id: text("account_id").notNull(),
    role_id: text("role_id").notNull(),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});