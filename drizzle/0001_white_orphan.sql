CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`create_time` integer NOT NULL,
	`update_time` integer,
	`delete_time` integer
);
