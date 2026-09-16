ALTER TABLE "customer_profiles" ADD COLUMN "country_code" varchar(5) DEFAULT '+91';--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "country_code" varchar(5) DEFAULT '+91';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "country_code" varchar(5) DEFAULT '+91';