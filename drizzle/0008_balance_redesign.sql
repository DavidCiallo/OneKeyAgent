-- Migration 0008: Rename subscription_record → transaction, remove token_amount, remove account.tokens
-- Steps:
--   1. Create new `transaction` table (copy of subscription_record minus token_amount)
--   2. Copy data from subscription_record to transaction
--   3. Drop subscription_record table
--   4. Drop tokens column from account table

CREATE TABLE IF NOT EXISTS `transaction` (
    `id` text PRIMARY KEY NOT NULL,
    `account_id` text NOT NULL,
    `txid` text NOT NULL,
    `amount` integer NOT NULL,
    `confirmations` integer DEFAULT 0 NOT NULL,
    `type` text DEFAULT 'topup' NOT NULL,
    `status` text DEFAULT 'pending' NOT NULL,
    `payment_id` text,
    `create_time` integer NOT NULL,
    `update_time` integer,
    `delete_time` integer
);

CREATE UNIQUE INDEX IF NOT EXISTS `transaction_txid_unique` ON `transaction` (`txid`);

INSERT INTO `transaction` (`id`, `account_id`, `txid`, `amount`, `confirmations`, `type`, `status`, `payment_id`, `create_time`, `update_time`, `delete_time`)
SELECT `id`, `account_id`, `txid`, `amount`, `confirmations`, `type`, `status`, `payment_id`, `create_time`, `update_time`, `delete_time`
FROM `subscription_record`;

DROP TABLE `subscription_record`;

ALTER TABLE `account` DROP COLUMN `tokens`;