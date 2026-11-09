CREATE TABLE "ledger"."fx_rate" (
	"currency" text NOT NULL,
	"as_of" text NOT NULL,
	"rate" text NOT NULL,
	"source" text NOT NULL,
	"fetched_at" bigint NOT NULL,
	CONSTRAINT "fx_rate_currency_as_of_pk" PRIMARY KEY("currency","as_of")
);
