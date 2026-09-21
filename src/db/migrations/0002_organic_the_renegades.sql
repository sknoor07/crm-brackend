ALTER TYPE "public"."job_item_status" ADD VALUE 'repair_started' BEFORE 'third_party_repair';--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "payment_confirmed" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "job_items" ALTER COLUMN "is_warranty_claim" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_profiles" DROP COLUMN "country_code";--> statement-breakpoint
ALTER TABLE "employee_profiles" DROP COLUMN "country_code";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "country_code";