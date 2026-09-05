CREATE TYPE "public"."job_status" AS ENUM('pending_cs_verification', 'ready_for_pickup', 'pending_pickup', 'pending_final_quote', 'awaiting_customer_approval', 'repair_in_progress', 'in_transit_to_lab', 'arrived_at_lab', 'in_lab_diagnosis', 'repair_completed', 'out_for_delivery', 'delivered', 'closed', 'repair_rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "account_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "account_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"phone" varchar(20),
	"billing_address" text
);
--> statement-breakpoint
CREATE TABLE "employee_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"phone" varchar(20),
	"date_of_birth" date,
	"aadhaar_number" varchar(12),
	"pan_number" varchar(10),
	"uan_number" varchar(12),
	"current_address" text,
	"permanent_address" text,
	"bank_account_number" varchar(50),
	"bank_ifsc_code" varchar(20),
	"bank_name" varchar(100),
	"emergency_contact_name" varchar(100),
	"emergency_contact_phone" varchar(20),
	"specializations" jsonb DEFAULT '[]',
	CONSTRAINT "employee_profiles_aadhaar_number_unique" UNIQUE("aadhaar_number"),
	CONSTRAINT "employee_profiles_pan_number_unique" UNIQUE("pan_number")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"is_revoked" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255),
	"user_type" varchar(20) DEFAULT 'customer' NOT NULL,
	"phone" varchar(20),
	"is_active" boolean DEFAULT true,
	"must_change_password" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"description" text,
	"permissions" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(50) NOT NULL,
	"manager_id" uuid,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "user_roles_user_id_role_id_unique" UNIQUE("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "device_service_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_category" varchar(100) NOT NULL,
	"charge_amount" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "device_service_charges_device_category_unique" UNIQUE("device_category")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_number" varchar(36) NOT NULL,
	"customer_id" uuid NOT NULL,
	"current_status" "job_status" DEFAULT 'pending_cs_verification' NOT NULL,
	"repair_location" varchar(20),
	"transport_manager_id" uuid,
	"repair_manager_id" uuid,
	"assigned_pickup_tech_id" uuid,
	"assigned_delivery_tech_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "jobs_job_number_unique" UNIQUE("job_number")
);
--> statement-breakpoint
CREATE TABLE "job_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"device_category" varchar(100) NOT NULL,
	"device_serial_number" varchar(50),
	"issue_description" text NOT NULL,
	"issue_category" varchar(50),
	"current_status" "job_status" DEFAULT 'pending_cs_verification' NOT NULL,
	"estimated_components_cost" numeric(10, 2),
	"final_components_cost" numeric(10, 2),
	"service_charge_applied" numeric(10, 2),
	"is_final_quote_approved" boolean DEFAULT false,
	"requested_components" text,
	"technician_notes" text,
	"base_repair_cost" numeric(10, 2),
	"is_warranty_claim" boolean DEFAULT false,
	"original_job_item_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"comment" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_item_id" uuid NOT NULL,
	"previous_status" "job_status",
	"new_status" "job_status" NOT NULL,
	"changed_by" uuid,
	"note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_closures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"closed_by_user_id" uuid NOT NULL,
	"closure_reason" text,
	"customer_confirmed" boolean DEFAULT false,
	"payment_confirmed" boolean DEFAULT false,
	"notes" text,
	"closed_at" timestamp DEFAULT now(),
	CONSTRAINT "job_closures_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "warranties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_item_id" uuid NOT NULL,
	"device_serial_number" varchar(50) NOT NULL,
	"device_imei" varchar(50),
	"original_repair_date" timestamp NOT NULL,
	"warranty_start" timestamp DEFAULT now(),
	"warranty_end" timestamp NOT NULL,
	"warranty_status" varchar(20) DEFAULT 'active' NOT NULL,
	"reason_for_return" text,
	"warranty_result" varchar(20),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "warranties_job_item_id_unique" UNIQUE("job_item_id")
);
--> statement-breakpoint
CREATE TABLE "repeat_repairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"current_job_item_id" uuid NOT NULL,
	"original_job_item_id" uuid NOT NULL,
	"device_serial_number" varchar(50) NOT NULL,
	"problem_description" text NOT NULL,
	"first_repair_date" timestamp NOT NULL,
	"repeat_count" integer DEFAULT 1,
	"last_repeat_date" timestamp,
	"days_since_first_repair" integer,
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "account_invitations" ADD CONSTRAINT "account_invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_transport_manager_id_users_id_fk" FOREIGN KEY ("transport_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_repair_manager_id_users_id_fk" FOREIGN KEY ("repair_manager_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_pickup_tech_id_users_id_fk" FOREIGN KEY ("assigned_pickup_tech_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_delivery_tech_id_users_id_fk" FOREIGN KEY ("assigned_delivery_tech_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_comments" ADD CONSTRAINT "job_comments_job_item_id_job_items_id_fk" FOREIGN KEY ("job_item_id") REFERENCES "public"."job_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_comments" ADD CONSTRAINT "job_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_job_item_id_job_items_id_fk" FOREIGN KEY ("job_item_id") REFERENCES "public"."job_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_status_history" ADD CONSTRAINT "job_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_closures" ADD CONSTRAINT "job_closures_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_closures" ADD CONSTRAINT "job_closures_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warranties" ADD CONSTRAINT "warranties_job_item_id_job_items_id_fk" FOREIGN KEY ("job_item_id") REFERENCES "public"."job_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repeat_repairs" ADD CONSTRAINT "repeat_repairs_current_job_item_id_job_items_id_fk" FOREIGN KEY ("current_job_item_id") REFERENCES "public"."job_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repeat_repairs" ADD CONSTRAINT "repeat_repairs_original_job_item_id_job_items_id_fk" FOREIGN KEY ("original_job_item_id") REFERENCES "public"."job_items"("id") ON DELETE no action ON UPDATE no action;