import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const taskTable = sqliteTable("task", {
    id: text("id").primaryKey(),
    task: text("task").notNull(),
    folder: text("folder").notNull().default(""),
    user: text("user").notNull().default(""),
    status: text("status").notNull().default("pending"),
    summary: text("summary"),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});