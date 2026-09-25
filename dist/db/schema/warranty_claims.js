import { pgTable, pgEnum, uuid, varchar, text, timestamp, index, } from "drizzle-orm/pg-core";
import { warranties } from "./warranties.js";
import { jobs } from "./jobs.js";
/* -------------------------------------------------------------------------- */
/* Issue Category                                                             */
/* -------------------------------------------------------------------------- */
export const warrantyIssueCategoryValues = [
    "display",
    "battery",
    "charging",
    "keyboard",
    "touchpad",
    "motherboard",
    "storage",
    "memory",
    "camera",
    "audio",
    "network",
    "connectivity",
    "software",
    "operating_system",
    "overheating",
    "physical_damage",
    "power",
    "performance",
    "other",
];
export const warrantyIssueCategory = pgEnum("warranty_issue_category", warrantyIssueCategoryValues);
/* -------------------------------------------------------------------------- */
/* Failure Type                                                               */
/* -------------------------------------------------------------------------- */
export const warrantyFailureTypeValues = [
    "component_failure",
    "component_wear",
    "manufacturing_defect",
    "installation_issue",
    "repair_failure",
    "repeat_failure",
    "software_issue",
    "user_damage",
    "physical_damage",
    "no_fault_found",
    "intermittent_failure",
    "unknown",
    "other",
];
export const warrantyFailureType = pgEnum("warranty_failure_type", warrantyFailureTypeValues);
/* -------------------------------------------------------------------------- */
/* Claim Status                                                               */
/* -------------------------------------------------------------------------- */
export const warrantyClaimStatusValues = [
    "open",
    "under_inspection",
    "approved",
    "rejected",
    "repair_in_progress",
    "completed",
    "cancelled",
];
export const warrantyClaimStatus = pgEnum("warranty_claim_status", warrantyClaimStatusValues);
/* -------------------------------------------------------------------------- */
/* Warranty Result                                                            */
/* -------------------------------------------------------------------------- */
export const warrantyResultValues = [
    "repaired",
    "replaced",
    "no_fault_found",
    "rejected",
    "customer_chargeable",
];
export const warrantyResult = pgEnum("warranty_result", warrantyResultValues);
/* -------------------------------------------------------------------------- */
/* Warranty Claims                                                            */
/* -------------------------------------------------------------------------- */
export const warrantyClaims = pgTable("warranty_claims", {
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
    // Customer-reported problem category
    issueCategory: warrantyIssueCategory("issue_category"),
    // Technician/repair-team determined failure
    failureType: warrantyFailureType("failure_type"),
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
}, (table) => ({
    warrantyIdx: index("warranty_claims_warranty_idx").on(table.warrantyId),
    repairJobIdx: index("warranty_claims_repair_job_idx").on(table.repairJobId),
    reportedAtIdx: index("warranty_claims_reported_at_idx").on(table.reportedAt),
}));
//issueCategory->	What the customer says is wrong->at the time 	Claim creation
//failureType	-> What the technician determines actually failed-> at the time of	Inspection
