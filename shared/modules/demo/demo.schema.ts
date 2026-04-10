import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const demoTable = sqliteTable("demo", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    create_time: text("create_time").notNull(),
    update_time: text("update_time"),
    delete_time: text("delete_time"),
});
