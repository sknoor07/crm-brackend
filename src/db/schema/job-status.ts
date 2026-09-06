import { pgEnum } from 'drizzle-orm/pg-core';

export const repairLocationValues = [
  'customer_site',
  'lab',
] as const;

export const repairLocation = pgEnum(
  'repair_location',
  repairLocationValues,
);

export type RepairLocation = (typeof repairLocationValues)[number];


/**
 * Overall workflow of a service job.
 */

export const jobSummaryStatusValues = [
  'in_progress',
  'done',
  'cancelled',
] as const;

export const jobSummaryStatus = pgEnum(
  'job_summary_status',
  jobSummaryStatusValues,
);

export type JobSummaryStatus =
  (typeof jobSummaryStatusValues)[number];

/**
 * Workflow of an individual repairable item.
 */
export const jobItemStatusValues = [
  // CS
  'pending_cs_verification',
  'approved_for_transport',

  // Transport / customer visit
  'transport_inspection',
  'pending_final_quote_onsite',
  'pending_lab_receipt',

  // Lab handover
  'received_at_lab',
  'pending_repair_assignment',

  // Repair assignment
  'assigned_to_repair_person',

  // Diagnosis
  'diagnosis_in_progress',

  // Quote
  'pending_final_quote',
  'awaiting_customer_approval',

  // Repair
  'repair_authorized',
  'repair_in_progress',

  // Lab inspection
  'pending_repair_manager_inspection',

  // Onsite completion / CS confirmation
  'pending_cs_confirmation',

  // Delivery
  'ready_for_delivery',
  'out_for_delivery',
  'delivered',

  // Terminal
  'repair_rejected',
  'cancelled',
] as const;

export const jobItemStatus = pgEnum('job_item_status',jobItemStatusValues);

export type JobItemStatus = (typeof jobItemStatusValues)[number];