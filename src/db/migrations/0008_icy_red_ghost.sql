CREATE TYPE "public"."warranty_status" AS ENUM('active', 'expired', 'void', 'completed');--> statement-breakpoint
CREATE TYPE "public"."warranty_claim_status" AS ENUM('open', 'under_inspection', 'approved', 'rejected', 'repair_in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."warranty_failure_type" AS ENUM('component_failure', 'component_wear', 'manufacturing_defect', 'installation_issue', 'repair_failure', 'repeat_failure', 'software_issue', 'user_damage', 'physical_damage', 'no_fault_found', 'intermittent_failure', 'unknown', 'other');--> statement-breakpoint
CREATE TYPE "public"."warranty_issue_category" AS ENUM('display', 'battery', 'charging', 'keyboard', 'touchpad', 'motherboard', 'storage', 'memory', 'camera', 'audio', 'network', 'connectivity', 'software', 'operating_system', 'overheating', 'physical_damage', 'power', 'performance', 'other');--> statement-breakpoint
CREATE TYPE "public"."warranty_result" AS ENUM('repaired', 'replaced', 'no_fault_found', 'rejected', 'customer_chargeable');--> statement-breakpoint
CREATE TYPE "public"."warranty_claim_action_type" AS ENUM('inspection', 'repair', 'replacement', 'reinstallation', 'adjustment', 'no_action');--> statement-breakpoint
CREATE TABLE "warranty_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warranty_id" uuid NOT NULL,
	"claim_number" varchar(50) NOT NULL,
	"repair_job_id" uuid,
	"reason_for_return" text NOT NULL,
	"issue_category" "warranty_issue_category",
	"failure_type" "warranty_failure_type",
	"diagnosis" text,
	"action_taken" text,
	"status" "warranty_claim_status" DEFAULT 'open' NOT NULL,
	"warranty_result" "warranty_result",
	"reported_at" timestamp DEFAULT now() NOT NULL,
	"inspected_at" timestamp,
	"resolved_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "warranty_claims_claim_number_unique" UNIQUE("claim_number")
);
--> statement-breakpoint
CREATE TABLE "warranty_claim_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warranty_claim_id" uuid NOT NULL,
	"action_type" "warranty_claim_action_type" NOT NULL,
	"component_name" varchar(200) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "warranties" DROP CONSTRAINT "warranties_job_item_id_unique";--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "current_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "current_status" SET DEFAULT 'in_progress'::text;--> statement-breakpoint
ALTER TABLE "job_status_history" ALTER COLUMN "previous_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "job_status_history" ALTER COLUMN "new_status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."job_summary_status";--> statement-breakpoint
CREATE TYPE "public"."job_summary_status" AS ENUM('created', 'in_progress', 'assigning_pickup_Engineer', 'pending_visit', 'repair_started', 'going_to_lab', 'pending_final_quote', 'repair_in_progress', 'repair_completed', 'waitng_for_delivery', 'delivered', 'closed', 'cancelled');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "current_status" SET DEFAULT 'in_progress'::"public"."job_summary_status";--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "current_status" SET DATA TYPE "public"."job_summary_status" USING "current_status"::"public"."job_summary_status";--> statement-breakpoint
ALTER TABLE "job_status_history" ALTER COLUMN "previous_status" SET DATA TYPE "public"."job_summary_status" USING "previous_status"::"public"."job_summary_status";--> statement-breakpoint
ALTER TABLE "job_status_history" ALTER COLUMN "new_status" SET DATA TYPE "public"."job_summary_status" USING "new_status"::"public"."job_summary_status";--> statement-breakpoint
ALTER TABLE "warranties" ALTER COLUMN "device_serial_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "warranties" ALTER COLUMN "warranty_start" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "warranties" ALTER COLUMN "warranty_start" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "warranties" ALTER COLUMN "warranty_status" SET DEFAULT 'active'::"public"."warranty_status";--> statement-breakpoint
ALTER TABLE "warranties" ALTER COLUMN "warranty_status" SET DATA TYPE "public"."warranty_status" USING "warranty_status"::"public"."warranty_status";--> statement-breakpoint
ALTER TABLE "warranties" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "warranties" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "warranties" ADD COLUMN "job_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "warranties" ADD COLUMN "quote_line_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "warranties" ADD COLUMN "component_name" varchar(200) NOT NULL;--> statement-breakpoint
ALTER TABLE "warranties" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "warranties" ADD COLUMN "warranty_months" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_warranty_id_warranties_id_fk" FOREIGN KEY ("warranty_id") REFERENCES "public"."warranties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claims" ADD CONSTRAINT "warranty_claims_repair_job_id_jobs_id_fk" FOREIGN KEY ("repair_job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranty_claim_items" ADD CONSTRAINT "warranty_claim_items_warranty_claim_id_warranty_claims_id_fk" FOREIGN KEY ("warranty_claim_id") REFERENCES "public"."warranty_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warranty_claims_warranty_idx" ON "warranty_claims" USING btree ("warranty_id");--> statement-breakpoint
CREATE INDEX "warranty_claims_repair_job_idx" ON "warranty_claims" USING btree ("repair_job_id");--> statement-breakpoint
CREATE INDEX "warranty_claims_reported_at_idx" ON "warranty_claims" USING btree ("reported_at");--> statement-breakpoint
CREATE INDEX "warranty_claim_items_claim_idx" ON "warranty_claim_items" USING btree ("warranty_claim_id");--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_quote_line_id_job_item_quote_lines_id_fk" FOREIGN KEY ("quote_line_id") REFERENCES "public"."job_item_quote_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "warranties_job_idx" ON "warranties" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "warranties_job_item_idx" ON "warranties" USING btree ("job_item_id");--> statement-breakpoint
ALTER TABLE "warranties" DROP COLUMN "original_repair_date";--> statement-breakpoint
ALTER TABLE "warranties" DROP COLUMN "reason_for_return";--> statement-breakpoint
ALTER TABLE "warranties" DROP COLUMN "warranty_result";--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_quote_line_id_unique" UNIQUE("quote_line_id");