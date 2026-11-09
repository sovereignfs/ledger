CREATE TABLE "ledger"."jar" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"account_id" text NOT NULL,
	"name" text NOT NULL,
	"target" bigint,
	"position" bigint NOT NULL,
	"archived_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger"."jar_movement" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"jar_id" text NOT NULL,
	"date" text NOT NULL,
	"amount" bigint NOT NULL,
	"txn_id" text,
	"kind" text NOT NULL,
	"month" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "jar_book_idx" ON "ledger"."jar" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "jar_account_idx" ON "ledger"."jar" USING btree ("book_id","account_id");--> statement-breakpoint
CREATE INDEX "jar_movement_jar_idx" ON "ledger"."jar_movement" USING btree ("book_id","jar_id");--> statement-breakpoint
CREATE INDEX "jar_movement_txn_idx" ON "ledger"."jar_movement" USING btree ("book_id","txn_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jar_movement_month_idx" ON "ledger"."jar_movement" USING btree ("jar_id","month");