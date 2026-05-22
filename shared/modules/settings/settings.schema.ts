import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const settingsTable = sqliteTable("settings", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});
