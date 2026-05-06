import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const subscriptionRecordTable = sqliteTable("subscription_record", {
    id: text("id").primaryKey(),
    account_id: text("account_id").notNull(),
    plan_name: text("plan_name").notNull(),
    txid: text("txid").notNull().unique(),
    from_address: text("from_address").notNull(),
    to_address: text("to_address").notNull(),
    chain: text("chain").notNull().default("trc20"),
    amount: integer("amount").notNull(),
    confirmations: integer("confirmations").notNull().default(0),
    status: text("status").notNull().default("pending"),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});
