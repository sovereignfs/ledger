CREATE TABLE `payee` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`last_subcategory_id` text,
	`last_account_id` text,
	`archived_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payee_book_name_idx` ON `payee` (`book_id`,`name_key`);