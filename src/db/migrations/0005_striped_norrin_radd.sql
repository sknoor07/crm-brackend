ALTER TABLE "invoices" ALTER COLUMN "currency" SET DATA TYPE varchar(10);--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "currency" SET DEFAULT 'INR';--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "pdf_storage_key" SET DATA TYPE varchar(500);