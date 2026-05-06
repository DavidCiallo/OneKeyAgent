CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`password` text NOT NULL,
	`api_key` text,
	`is_admin` integer DEFAULT 0 NOT NULL,
	`monthly_limit` integer DEFAULT 120000000,
	`tg_chat_id` text,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
--> statement-breakpoint
CREATE TABLE `model` (
	`id` text PRIMARY KEY NOT NULL,
	`alias` text NOT NULL,
	`tier` integer DEFAULT 1 NOT NULL,
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
