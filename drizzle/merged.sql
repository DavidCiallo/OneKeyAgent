-- Merged schema (all migrations 0000–0008 applied)
-- Generated 2026-05-11

CREATE TABLE IF NOT EXISTS `account` (
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

CREATE TABLE IF NOT EXISTS `account_role` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`role_id` text NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);

CREATE TABLE IF NOT EXISTS `gift_card` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'unused' NOT NULL,
	`redeemed_by` text,
	`redeemed_at` integer,
	`token_amount` integer DEFAULT 0 NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);

CREATE UNIQUE INDEX IF NOT EXISTS `gift_card_code_unique` ON `gift_card` (`code`);

CREATE TABLE IF NOT EXISTS `model` (
	`id` text PRIMARY KEY NOT NULL,
	`alias` text NOT NULL,
	`is_public` integer DEFAULT 0,
	`input_price` integer DEFAULT 0 NOT NULL,
	`output_price` integer DEFAULT 0 NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);

CREATE TABLE IF NOT EXISTS `provider` (
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

CREATE TABLE IF NOT EXISTS `role` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);

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

CREATE TABLE IF NOT EXISTS `task` (
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

CREATE TABLE IF NOT EXISTS `usage_log` (
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
