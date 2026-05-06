import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const subscriptionRecordTable = sqliteTable("subscription_record", {
    id: text("id").primaryKey(),
    account_id: text("account_id").notNull(),
    plan_name: text("plan_name").notNull(),
    txid: text("txid").notNull().unique(),
    amount: integer("amount").notNull(),
    confirmations: integer("confirmations").notNull().default(0),
    status: text("status").notNull().default("pending"),
    payment_id: text("payment_id"),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});
