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


export const jobItems = pgTable('job_items', {
  id: uuid('id').defaultRandom().primaryKey(),

  jobId: uuid('job_id')
    .references(() => jobs.id)
    .notNull(),

  deviceCategory: varchar('device_category', {
    length: 100,
  }).notNull(),

  deviceSerialNumber: varchar('device_serial_number', {
    length: 50,
  }),

  issueDescription: text('issue_description').notNull(),

  issueCategory: varchar('issue_category', {
    length: 50,
  }),

  repairLocation: repairLocation('repair_location')
    .notNull()
    .default('customer_site'),

  currentStatus: jobItemStatus('current_status')
    .notNull()
    .default('created'),

  isApprovedByCS: boolean('is_approved_by_cs')
    .notNull()
    .default(false),

  // Customer authorization for onsite repair
  onsiteRepairAuthorized: boolean('onsite_repair_authorized')
    .notNull()
    .default(false),

  // True only when an actual onsite repair was completed
  repairFinishedOnsite: boolean('repair_finished_onsite')
    .notNull()
    .default(false),

  // Customer authorization for in-lab repair
  inlabRepairAuthorized: boolean('inlab_repair_authorized')
    .notNull()
    .default(false),

  // True when repair should not continue internally
  inlabRepairRejected: boolean('inlab_repair_rejected')
    .notNull()
    .default(false),

  // True while item is with third-party vendor
  vendorOut: boolean('vendor_out')
    .notNull()
    .default(false),

  assignedRepairPersonId: uuid('assigned_repair_person_id')
    .references(() => users.id),

  estimatedComponentsCost: decimal(
    'estimated_components_cost',
    {
      precision: 10,
      scale: 2,
    },
  ),

  finalComponentsCost: decimal(
    'final_components_cost',
    {
      precision: 10,
      scale: 2,
    },
  ),

  serviceChargeApplied: decimal(
    'service_charge_applied',
    {
      precision: 10,
      scale: 2,
    },
  ),

  isFinalQuoteApproved: boolean('is_final_quote_approved')
    .default(false),

  requestedComponents: text('requested_components'),

  diagnosisNotes: text('diagnosis_notes'),

  repairNotes: text('repair_notes'),

  baseRepairCost: decimal(
    'base_repair_cost',
    {
      precision: 10,
      scale: 2,
    },
  ),

  isWarrantyClaim: boolean('is_warranty_claim')
    .default(false),

  originalJobItemId: uuid('original_job_item_id'),

  createdAt: timestamp('created_at').defaultNow(),

  updatedAt: timestamp('updated_at').defaultNow(),
});