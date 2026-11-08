CREATE TABLE "ledger"."book" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_currency" text,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"first_day_of_week" bigint DEFAULT 1 NOT NULL,
	"locale" text,
	"recap" boolean DEFAULT true NOT NULL,
	"setup_done_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."book_member" (
	"book_id" text NOT NULL,
	"account_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "book_member_book_id_account_id_pk" PRIMARY KEY("book_id","account_id")
);
--> statement-breakpoint
CREATE INDEX "book_member_account_idx" ON "ledger"."book_member" USING btree ("account_id");