ALTER TABLE "job_item_quote_lines" ADD COLUMN "warranty_months" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "name" varchar(200) NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "warranty_months" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" DROP COLUMN "description";