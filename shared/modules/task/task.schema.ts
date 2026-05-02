import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const taskTable = sqliteTable("task", {
    id: text("id").primaryKey(),
    account_id: text("account_id").notNull(),
    task_text: text("task_text").notNull(),
    folder: text("folder"),
    status: text("status").notNull().default("pending"), // pending | processing | completed | failed
    result: text("result"),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});
