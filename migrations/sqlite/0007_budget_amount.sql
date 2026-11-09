CREATE TABLE `budget_amount` (
	`book_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`from_month` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`book_id`, `target_kind`, `target_id`, `from_month`)
);
