CREATE TABLE `fx_rate` (
	`currency` text NOT NULL,
	`as_of` text NOT NULL,
	`rate` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`currency`, `as_of`)
);
