CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`api_key` text,
	`is_admin` integer DEFAULT 0 NOT NULL,
	`tg_chat_id` text,
	`last_daily_time` integer,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE TABLE `model` (
	`id` text PRIMARY KEY NOT NULL,
	`alias` text NOT NULL,
	`input_price` integer DEFAULT 0 NOT NULL,
	`output_price` integer DEFAULT 0 NOT NULL,
	`is_public` integer DEFAULT 0,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE TABLE `usage_log` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`model_alias` text NOT NULL,
	`provider_id` text DEFAULT '',
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`input_price` integer DEFAULT 0 NOT NULL,
	`output_price` integer DEFAULT 0 NOT NULL,
	`create_time` integer,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE TABLE `account_role` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`role_id` text NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE TABLE `role` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE TABLE `provider` (
	`id` text PRIMARY KEY NOT NULL,
	`model_alias` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`api_key` text,
	`auth_type` text DEFAULT 'bearer',
	`api_type` text DEFAULT 'openai',
	`proxy_url` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`task_text` text NOT NULL,
	`folder` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE TABLE `transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`txid` text NOT NULL,
	`amount` integer NOT NULL,
	`confirmations` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_id` text,
	`type` text DEFAULT 'topup' NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_txid_unique` ON `transaction` (`txid`);--> statement-breakpoint
CREATE TABLE `gift_card` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`token_amount` integer NOT NULL,
	`status` text DEFAULT 'unused' NOT NULL,
	`redeemed_by` text,
	`redeemed_at` integer,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_card_code_unique` ON `gift_card` (`code`);