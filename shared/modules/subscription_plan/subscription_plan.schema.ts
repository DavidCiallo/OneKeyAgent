import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const subscriptionPlanTable = sqliteTable("subscription_plan", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    monthly_limit: integer("monthly_limit").notNull(),
    price: integer("price").notNull().default(0),
    duration_days: integer("duration_days").notNull().default(30),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});
