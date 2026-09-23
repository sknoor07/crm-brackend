CREATE TYPE "public"."gst_type" AS ENUM('none', 'intra_state', 'inter_state');--> statement-breakpoint
ALTER TABLE "job_quotes" RENAME COLUMN "csgst" TO "cgst";--> statement-breakpoint
ALTER TABLE "job_quotes" ADD COLUMN "igst" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "job_quotes" ADD COLUMN "gst_type" "gst_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "igst" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "gst_type" "gst_type" DEFAULT 'none' NOT NULL;--> statement-breakpoint
UPDATE "job_quotes"
SET "gst_type" = 'intra_state'
WHERE "cgst" IS NOT NULL AND "sgst" IS NOT NULL;--> statement-breakpoint
UPDATE "invoices"
SET "gst_type" = 'intra_state'
WHERE "cgst" IS NOT NULL AND "sgst" IS NOT NULL;