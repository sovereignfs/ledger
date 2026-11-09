CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `category_book_idx` ON `category` (`book_id`,`position`);--> statement-breakpoint
CREATE TABLE `income_source` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `income_source_book_idx` ON `income_source` (`book_id`);--> statement-breakpoint
CREATE TABLE `money_account` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`currency` text NOT NULL,
	`credit_limit` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `money_account_book_idx` ON `money_account` (`book_id`,`position`);--> statement-breakpoint
CREATE TABLE `subcategory` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`budget_source` text DEFAULT 'manual' NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `subcategory_category_idx` ON `subcategory` (`book_id`,`category_id`,`position`);--> statement-breakpoint
CREATE TABLE `txn` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`payee_id` text,
	`note` text,
	`status` text NOT NULL,
	`recurring_id` text,
	`occurrence_date` text,
	`original_amount` integer,
	`original_currency` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `txn_book_date_idx` ON `txn` (`book_id`,`date`);--> statement-breakpoint
CREATE INDEX `txn_book_status_idx` ON `txn` (`book_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `txn_recurring_occurrence_idx` ON `txn` (`recurring_id`,`occurrence_date`);--> statement-breakpoint
CREATE TABLE `txn_line` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`txn_id` text NOT NULL,
	`account_id` text,
	`subcategory_id` text,
	`income_source_id` text,
	`equity` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `txn_line_txn_idx` ON `txn_line` (`book_id`,`txn_id`);--> statement-breakpoint
CREATE INDEX `txn_line_account_idx` ON `txn_line` (`book_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `txn_line_subcategory_idx` ON `txn_line` (`book_id`,`subcategory_id`);--> statement-breakpoint
CREATE INDEX `txn_line_income_source_idx` ON `txn_line` (`book_id`,`income_source_id`);