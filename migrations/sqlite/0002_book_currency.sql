CREATE TABLE `book_currency` (
	`book_id` text NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`book_id`, `code`)
);
