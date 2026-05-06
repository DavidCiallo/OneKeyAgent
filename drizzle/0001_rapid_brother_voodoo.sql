CREATE TABLE `subscription_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`monthly_limit` integer NOT NULL,
	`price` integer DEFAULT 0 NOT NULL,
	`duration_days` integer DEFAULT 30 NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE TABLE `subscription_record` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`plan_name` text NOT NULL,
	`txid` text NOT NULL,
	`from_address` text NOT NULL,
	`to_address` text NOT NULL,
	`chain` text DEFAULT 'trc20' NOT NULL,
	`amount` integer NOT NULL,
	`confirmations` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscription_record_txid_unique` ON `subscription_record` (`txid`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`api_key` text,
	`is_admin` integer DEFAULT 0 NOT NULL,
	`monthly_limit` integer DEFAULT 60000000,
	`plan` text DEFAULT 'free' NOT NULL,
	`plan_expires_at` integer,
	`sub_wallet_address` text,
	`tg_chat_id` text,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
INSERT INTO `__new_account`("id", "name", "email", "password", "api_key", "is_admin", "monthly_limit", "plan", "plan_expires_at", "sub_wallet_address", "tg_chat_id", "create_time", "update_time", "delete_time") SELECT "id", "name", "email", "password", "api_key", "is_admin", "monthly_limit", "plan", "plan_expires_at", "sub_wallet_address", "tg_chat_id", "create_time", "update_time", "delete_time" FROM `account`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;--> statement-breakpoint
PRAGMA foreign_keys=ON;