import { db } from '../../config/database.js';

import {
  JobItemStatus,
  jobComments,
  jobItemStatusHistory,
} from '../../db/schema/index.js';


// --------------------------------------------------
// Database transaction type
// --------------------------------------------------

export type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];


// --------------------------------------------------
// Allowed job item status transitions
// --------------------------------------------------

export const allowedJobItemTransitions: Record<
  string,
  JobItemStatus[]
> = {
  // Initial
  created: [
    'pending_cs_verification',
  ],

  // CS approval
  pending_cs_verification: [
    'approved_for_transport',
    'repair_rejected',
  ],

  // Transport
  approved_for_transport: [
    'transport_visit_in_progress',
  ],

  // Transport decides where the item goes
  transport_visit_in_progress: [
    'delivered',
    'repair_rejected',
    'pending_final_quote',
    'pending_lab_receipt',
  ],

  // Lab handover
  pending_lab_receipt: [
    'received_at_lab',
  ],

  received_at_lab: [
    'assigned_to_repair_manager',
  ],

  // Repair manager
  assigned_to_repair_manager: [
    'assigned_to_repair_person',
    'ready_for_delivery',
    'third_party_repair',
  ],

  // Third-party vendor
  third_party_repair: [
    'assigned_to_repair_manager',
  ],

  // Repair person
  assigned_to_repair_person: [
    'pending_final_quote',
    'assigned_to_repair_manager',
  ],

  // Quote
  pending_final_quote: [
    'awaiting_customer_approval',
    'ready_for_delivery',
  ],

  // Customer approval
  awaiting_customer_approval: [
    'assigned_to_repair_person',
    'transport_visit_in_progress',
    'pending_final_quote',
  ],

  // Repair manager inspection
  pending_repair_manager_inspection: [
    'assigned_to_repair_person',
    'ready_for_delivery',
  ],

  // Delivery
  ready_for_delivery: [
    'out_for_delivery',
  ],

  out_for_delivery: [
    'delivered',
  ],

  delivered: [],

  // Terminal
  repair_rejected: [],

  cancelled: [],
};

// --------------------------------------------------
// Update job item with status transition
// --------------------------------------------------

export const updateJobItemWithStatusTransition = async <T>(
  jobItemId: string,
  previousStatus: JobItemStatus | null,
  newStatus: JobItemStatus,
  updateJobItem: (
    tx: DbTransaction,
  ) => Promise<T>,
  changedBy: string,
  note: string,
  existingTx?: DbTransaction,
): Promise<T> => {

  // If previous status is null, treat the item as newly created.
  const effectivePreviousStatus  = previousStatus ?? 'created';

  // ------------------------------------------------
  // Validate transition
  // ------------------------------------------------

  if (
    !allowedJobItemTransitions[effectivePreviousStatus ]?.includes(
      newStatus,
    )
  ) {
    throw new Error(
      `Invalid job item status transition: ${effectivePreviousStatus } -> ${newStatus}`,
    );
  }

  // ------------------------------------------------
  // Execute transition
  // ------------------------------------------------

  const executeTransition = async (
    tx: DbTransaction,
  ): Promise<T> => {

    // Update the actual job item
    const updatedJobItem = await updateJobItem(tx);

    // Record status history
    await tx.insert(jobItemStatusHistory).values({
      jobItemId,
      previousStatus:effectivePreviousStatus ,
      newStatus,
      changedBy,
      note,
    });

    // Record item comment
    await tx.insert(jobComments).values({
      jobItemId,
      userId: changedBy,
      comment: note,
    });

    return updatedJobItem;
  };


  // ------------------------------------------------
  // Use existing transaction when provided
  // ------------------------------------------------

  if (existingTx) {
    return executeTransition(existingTx);
  }


  // ------------------------------------------------
  // Otherwise create a new transaction
  // ------------------------------------------------

  return db.transaction(async (tx) => {
    return executeTransition(tx);
  });
};