CREATE SEQUENCE "public"."invoice_number_sequence" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "job_quotes" RENAME COLUMN "tax" TO "csgst";--> statement-breakpoint
ALTER TABLE "invoices" RENAME COLUMN "tax" TO "cgst";--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN "gstin" varchar(15);--> statement-breakpoint
ALTER TABLE "job_quotes" ADD COLUMN "sgst" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sgst" numeric(10, 2);