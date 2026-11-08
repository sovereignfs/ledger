CREATE TABLE "ledger"."book_currency" (
	"book_id" text NOT NULL,
	"code" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "book_currency_book_id_code_pk" PRIMARY KEY("book_id","code")
);
