CREATE TABLE `book` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_currency` text,
	`time_zone` text DEFAULT 'UTC' NOT NULL,
	`first_day_of_week` integer DEFAULT 1 NOT NULL,
	`locale` text,
	`recap` integer DEFAULT true NOT NULL,
	`setup_done_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `book_member` (
	`book_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`book_id`, `account_id`)
);
--> statement-breakpoint
CREATE INDEX `book_member_account_idx` ON `book_member` (`account_id`);