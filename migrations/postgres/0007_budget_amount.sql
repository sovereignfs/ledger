CREATE TABLE "ledger"."budget_amount" (
	"book_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"from_month" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "budget_amount_book_id_target_kind_target_id_from_month_pk" PRIMARY KEY("book_id","target_kind","target_id","from_month")
);
