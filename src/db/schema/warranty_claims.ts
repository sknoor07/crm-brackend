import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

import { warranties } from "./warranties.js";
import { jobs } from "./jobs.js";
export const warrantyClaimStatusValues = [
  "open",
  "under_inspection",
  "approved",
  "rejected",
  "repair_in_progress",
  "completed",
  "cancelled",
] as const;

export const warrantyClaimStatus = pgEnum(
  "warranty_claim_status",
  warrantyClaimStatusValues,
);

export const warrantyResultValues = [
  "repaired",
  "replaced",
  "no_fault_found",
  "rejected",
  "customer_chargeable",
] as const;

export const warrantyResult = pgEnum(
  "warranty_result",
  warrantyResultValues,
);


export const warrantyClaims = pgTable(
  "warranty_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    warrantyId: uuid("warranty_id")
      .references(() => warranties.id)
      .notNull(),

    claimNumber: varchar("claim_number", {
      length: 50,
    })
      .notNull()
      .unique(),

    repairJobId: uuid("repair_job_id")
      .references(() => jobs.id),

    reasonForReturn: text("reason_for_return")
      .notNull(),

    diagnosis: text("diagnosis"),

    actionTaken: text("action_taken"),

    status: warrantyClaimStatus("status")
      .notNull()
      .default("open"),

    warrantyResult: warrantyResult("warranty_result"),

    reportedAt: timestamp("reported_at")
      .defaultNow()
      .notNull(),

    inspectedAt: timestamp("inspected_at"),

    resolvedAt: timestamp("resolved_at"),

    notes: text("notes"),

    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    warrantyIdx: index("warranty_claims_warranty_idx")
      .on(table.warrantyId),

    repairJobIdx: index("warranty_claims_repair_job_idx")
      .on(table.repairJobId),
  }),
);