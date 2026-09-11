import { pgEnum } from 'drizzle-orm/pg-core';

export const repairLocationValues = [
  'customer_site',
  'inlab',
] as const;

export const repairLocation = pgEnum(
  'repair_location',
  repairLocationValues,
);

export type RepairLocation =
  (typeof repairLocationValues)[number];


/**
 * Overall workflow of a service job.
 */
export const jobSummaryStatusValues = [
  'created',
  'in_progress',
  'repair_started',

  'assigning_pickup_Engineer',

  'pending_visit',
  'repair_completed_onsite',

  'going_to_lab',

  'repair_in_progress_inlab',

  'repair_completed_inlab',

  'waitng_for_delivery',

  'pending_final_quote_onsite',

  'delivered',

  'closed',

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
  // Initial / CS
  'created',
  'pending_cs_verification',
  'approved_for_transport',

  // Transport / Customer Visit
  'transport_visit_in_progress',

  // Quote
  // Used for both onsite and in-lab repairs.
  // repairLocation determines where the repair is happening.
  'pending_final_quote',
  'removed_from_quote',

  // Lab Handover
  'pending_lab_receipt',
  'received_at_lab',

  // Repair Assignment
  'assigned_to_repair_manager',
  'assigned_to_repair_person',

  // Customer Approval
  'awaiting_customer_approval',

  // Third-party Repair
  'third_party_repair',

  // Lab Repair Manager
  'pending_repair_manager_inspection',

  // Delivery
  'ready_for_delivery',
  'out_for_delivery',
  'delivered',

  // Terminal
  'repair_rejected',
  'cancelled',
] as const;

export const jobItemStatus = pgEnum(
  'job_item_status',
  jobItemStatusValues,
);

export type JobItemStatus =
  (typeof jobItemStatusValues)[number];