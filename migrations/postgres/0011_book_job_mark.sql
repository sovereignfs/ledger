CREATE TABLE "ledger"."book_job_mark" (
	"book_id" text NOT NULL,
	"kind" text NOT NULL,
	"mark" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "book_job_mark_book_id_kind_mark_pk" PRIMARY KEY("book_id","kind","mark")
);
