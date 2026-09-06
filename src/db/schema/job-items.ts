import {
    pgTable,
    uuid,
    varchar,
    text,
    timestamp,
    decimal,
    boolean,
} from 'drizzle-orm/pg-core';

import { jobs } from './jobs.js';
import { users } from './users.js';
import { jobItemStatus, repairLocation } from './job-status.js';


export const jobItems = pgTable('job_items', {id: uuid('id').defaultRandom().primaryKey(),

    jobId: uuid('job_id').references(() => jobs.id).notNull(),

    deviceCategory: varchar('device_category', {length: 100,}).notNull(),

    deviceSerialNumber: varchar('device_serial_number', {length: 50,}),

    issueDescription: text('issue_description').notNull(),

    issueCategory: varchar('issue_category', {length: 50,}),
    repairLocation: repairLocation('repair_location',).notNull().default('customer_site'),
    /**
     * Current workflow status of this individual item.
     */
    currentStatus: jobItemStatus('current_status').notNull().default('pending_cs_verification'),

    isApprovedByCS:boolean('is_approved_by_cs').notNull().default(true),

    /**
     * Repair Team Manager assigns an individual item
     * to a repair person.
     */
    assignedRepairPersonId: uuid('assigned_repair_person_id',).references(() => users.id),

    estimatedComponentsCost: decimal('estimated_components_cost',{precision: 10,scale: 2,},),

    finalComponentsCost: decimal('final_components_cost',{precision: 10,scale: 2,},),

    serviceChargeApplied: decimal('service_charge_applied',{precision: 10,scale: 2,},),

    isFinalQuoteApproved: boolean('is_final_quote_approved',).default(false),

    requestedComponents: text('requested_components',),

    diagnosisNotes: text('diagnosis_notes'),

    repairNotes: text('repair_notes'),
    baseRepairCost: decimal('base_repair_cost',{precision: 10,scale: 2,},),

    isWarrantyClaim: boolean('is_warranty_claim',).default(false),

    originalJobItemId: uuid('original_job_item_id',),

    createdAt: timestamp('created_at').defaultNow(),

    updatedAt: timestamp('updated_at').defaultNow(),
});