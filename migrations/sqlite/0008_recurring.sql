CREATE TABLE `recurring` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`template` text NOT NULL,
	`unit` text NOT NULL,
	`every` integer NOT NULL,
	`anchor_date` text NOT NULL,
	`end_date` text,
	`mode` text NOT NULL,
	`next_date` text,
	`loan_account_id` text,
	`ended_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recurring_next_idx` ON `recurring` (`next_date`);--> statement-breakpoint
CREATE INDEX `recurring_book_idx` ON `recurring` (`book_id`);--> statement-breakpoint
CREATE TABLE `recurring_skip` (
	`recurring_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`book_id` text NOT NULL,
	PRIMARY KEY(`recurring_id`, `occurrence_date`)
);
