CREATE TABLE "ledger"."loan" (
	"account_id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"lender" text NOT NULL,
	"principal" bigint NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"instalment" bigint NOT NULL,
	"yearly_rate" text,
	"interest_subcategory_id" text
);
