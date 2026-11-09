CREATE TABLE `book_job_mark` (
	`book_id` text NOT NULL,
	`kind` text NOT NULL,
	`mark` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`book_id`, `kind`, `mark`)
);
