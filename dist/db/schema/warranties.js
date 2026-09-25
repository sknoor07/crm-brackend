import { pgTable, uuid, varchar, timestamp, integer, pgEnum, index, } from "drizzle-orm/pg-core";
import { jobItems } from "./job-items.js";
import { jobItemQuoteLines } from "./job-item-quote-lines.js";
import { jobs } from "./jobs.js";
export const warrantyStatusValues = [
    "active",
    "expired",
    "void",
    "completed",
];
export const warrantyStatus = pgEnum("warranty_status", warrantyStatusValues);
export const warranties = pgTable("warranties", {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
        .references(() => jobs.id)
        .notNull(),
    jobItemId: uuid("job_item_id")
        .references(() => jobItems.id)
        .notNull(),
    quoteLineId: uuid("quote_line_id")
        .references(() => jobItemQuoteLines.id)
        .notNull()
        .unique(),
    componentName: varchar("component_name", {
        length: 200,
    }).notNull(),
    quantity: integer("quantity")
        .notNull()
        .default(1),
    deviceSerialNumber: varchar("device_serial_number", {
        length: 50,
    }),
    deviceImei: varchar("device_imei", {
        length: 50,
    }),
    warrantyMonths: integer("warranty_months").notNull(),
    warrantyStart: timestamp("warranty_start").notNull(),
    warrantyEnd: timestamp("warranty_end").notNull(),
    warrantyStatus: warrantyStatus("warranty_status")
        .notNull()
        .default("active"),
    createdAt: timestamp("created_at")
        .defaultNow()
        .notNull(),
    updatedAt: timestamp("updated_at")
        .defaultNow()
        .notNull(),
}, (table) => ({
    jobIdx: index("warranties_job_idx").on(table.jobId),
    jobItemIdx: index("warranties_job_item_idx").on(table.jobItemId),
}));
