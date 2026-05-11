import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const modelTable = sqliteTable("model", {
    id: text("id").primaryKey(),
    alias: text("alias").notNull(),
    input_price: integer("input_price").notNull().default(0),
    output_price: integer("output_price").notNull().default(0),
    is_public: integer("is_public").default(0),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});
