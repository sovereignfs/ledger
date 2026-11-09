CREATE TABLE "ledger"."month_review" (
	"book_id" text NOT NULL,
	"month" text NOT NULL,
	"reviewed_at" bigint NOT NULL,
	"reviewed_by" text NOT NULL,
	CONSTRAINT "month_review_book_id_month_pk" PRIMARY KEY("book_id","month")
);
