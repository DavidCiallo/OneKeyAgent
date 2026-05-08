import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const giftCardTable = sqliteTable("gift_card", {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    plan_name: text("plan_name").notNull(),
    duration_days: integer("duration_days").notNull(),
    status: text("status").notNull().default("unused"), // unused | redeemed | expired
    redeemed_by: text("redeemed_by"),
    redeemed_at: integer("redeemed_at"),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});