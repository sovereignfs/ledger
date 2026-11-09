CREATE TABLE "ledger"."recurring" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"template" text NOT NULL,
	"unit" text NOT NULL,
	"every" bigint NOT NULL,
	"anchor_date" text NOT NULL,
	"end_date" text,
	"mode" text NOT NULL,
	"next_date" text,
	"loan_account_id" text,
	"ended_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."recurring_skip" (
	"recurring_id" text NOT NULL,
	"occurrence_date" text NOT NULL,
	"book_id" text NOT NULL,
	CONSTRAINT "recurring_skip_recurring_id_occurrence_date_pk" PRIMARY KEY("recurring_id","occurrence_date")
);
--> statement-breakpoint
CREATE INDEX "recurring_next_idx" ON "ledger"."recurring" USING btree ("next_date");--> statement-breakpoint
CREATE INDEX "recurring_book_idx" ON "ledger"."recurring" USING btree ("book_id");