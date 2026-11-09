CREATE TABLE `month_review` (
	`book_id` text NOT NULL,
	`month` text NOT NULL,
	`reviewed_at` integer NOT NULL,
	`reviewed_by` text NOT NULL,
	PRIMARY KEY(`book_id`, `month`)
);
