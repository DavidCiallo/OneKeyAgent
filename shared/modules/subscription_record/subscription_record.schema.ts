import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const transactionTable = sqliteTable("transaction", {
    id: text("id").primaryKey(),
    account_id: text("account_id").notNull(),
    txid: text("txid").notNull().unique(),
    amount: integer("amount").notNull(),
    confirmations: integer("confirmations").notNull().default(0),
    status: text("status").notNull().default("pending"),
    payment_id: text("payment_id"),
    type: text("type").notNull().default("topup"),
    create_time: integer("create_time").notNull(),
    update_time: integer("update_time"),
    delete_time: integer("delete_time"),
});