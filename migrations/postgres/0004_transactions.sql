CREATE TABLE "ledger"."category" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"position" bigint DEFAULT 0 NOT NULL,
	"archived_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."income_source" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"currency" text NOT NULL,
	"archived_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."money_account" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"currency" text NOT NULL,
	"credit_limit" bigint,
	"position" bigint DEFAULT 0 NOT NULL,
	"archived_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."subcategory" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"category_id" text NOT NULL,
	"name" text NOT NULL,
	"budget_source" text DEFAULT 'manual' NOT NULL,
	"position" bigint DEFAULT 0 NOT NULL,
	"archived_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."txn" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"type" text NOT NULL,
	"date" text NOT NULL,
	"payee_id" text,
	"note" text,
	"status" text NOT NULL,
	"recurring_id" text,
	"occurrence_date" text,
	"original_amount" bigint,
	"original_currency" text,
	"created_by" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."txn_line" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"txn_id" text NOT NULL,
	"account_id" text,
	"subcategory_id" text,
	"income_source_id" text,
	"equity" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"position" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "category_book_idx" ON "ledger"."category" USING btree ("book_id","position");--> statement-breakpoint
CREATE INDEX "income_source_book_idx" ON "ledger"."income_source" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "money_account_book_idx" ON "ledger"."money_account" USING btree ("book_id","position");--> statement-breakpoint
CREATE INDEX "subcategory_category_idx" ON "ledger"."subcategory" USING btree ("book_id","category_id","position");--> statement-breakpoint
CREATE INDEX "txn_book_date_idx" ON "ledger"."txn" USING btree ("book_id","date");--> statement-breakpoint
CREATE INDEX "txn_book_status_idx" ON "ledger"."txn" USING btree ("book_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "txn_recurring_occurrence_idx" ON "ledger"."txn" USING btree ("recurring_id","occurrence_date");--> statement-breakpoint
CREATE INDEX "txn_line_txn_idx" ON "ledger"."txn_line" USING btree ("book_id","txn_id");--> statement-breakpoint
CREATE INDEX "txn_line_account_idx" ON "ledger"."txn_line" USING btree ("book_id","account_id");--> statement-breakpoint
CREATE INDEX "txn_line_subcategory_idx" ON "ledger"."txn_line" USING btree ("book_id","subcategory_id");--> statement-breakpoint
CREATE INDEX "txn_line_income_source_idx" ON "ledger"."txn_line" USING btree ("book_id","income_source_id");