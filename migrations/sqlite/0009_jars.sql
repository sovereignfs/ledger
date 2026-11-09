CREATE TABLE `jar` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`target` integer,
	`position` integer NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jar_book_idx` ON `jar` (`book_id`);--> statement-breakpoint
CREATE INDEX `jar_account_idx` ON `jar` (`book_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `jar_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`jar_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`txn_id` text,
	`kind` text NOT NULL,
	`month` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jar_movement_jar_idx` ON `jar_movement` (`book_id`,`jar_id`);--> statement-breakpoint
CREATE INDEX `jar_movement_txn_idx` ON `jar_movement` (`book_id`,`txn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jar_movement_month_idx` ON `jar_movement` (`jar_id`,`month`);