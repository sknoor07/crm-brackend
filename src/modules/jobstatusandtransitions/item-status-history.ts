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
  created: [
    'pending_cs_verification',
    'awaiting_customer_approval',
    'approved_for_transport',
  ],

  pending_cs_verification: [
    'approved_for_transport',
    'repair_rejected',
  ],

  approved_for_transport: [
    'transport_visit_in_progress',
  ],

  transport_visit_in_progress: [
    'repair_rejected',
    'pending_final_quote',
    'pending_lab_receipt',
  ],

  pending_lab_receipt: [
    'received_at_lab',
  ],

  received_at_lab: [
    'assigned_to_repair_manager',
  ],

  assigned_to_repair_manager: [
    'assigned_to_repair_person',
    'ready_for_delivery',
    'third_party_repair',
  ],

  third_party_repair: [
    'assigned_to_repair_manager',
  ],

  assigned_to_repair_person: [
    'pending_final_quote',
    'assigned_to_repair_manager',
    'pending_lab_receipt',
  ],

  pending_final_quote: [
    'awaiting_customer_approval',
    'ready_for_delivery',
    'removed_from_quote',
  ],

  awaiting_customer_approval: [
    'assigned_to_repair_person',
    'repair_started',
    'pending_final_quote',
  ],

  repair_started: [
    'delivered',
  ],

  pending_repair_manager_inspection: [
    'assigned_to_repair_person',
    'ready_for_delivery',
  ],

  ready_for_delivery: [
    'out_for_delivery',
  ],

  out_for_delivery: [
    'delivered',
  ],

  delivered: [],

  repair_rejected: [
    'repair_rejected',
  ],

  cancelled: [],
};

export const updateJobItemWithStatusTransition = async <T>(
  jobItemId: string,
  previousStatus: JobItemStatus | null,
  newStatus: JobItemStatus,
  updateJobItem: (
    tx: DbTransaction,
  ) => Promise<T | null>,
  changedBy: string,
  note: string,
  existingTx?: DbTransaction,
): Promise<T> => {

  const effectivePreviousStatus =
    previousStatus ?? 'created';

  // --------------------------------------------------
  // Validate transition
  // --------------------------------------------------

  if (
    !allowedJobItemTransitions[
      effectivePreviousStatus
    ]?.includes(newStatus)
  ) {
    throw new Error(
      `Invalid job item status transition: ${effectivePreviousStatus} -> ${newStatus}`,
    );
  }

  // --------------------------------------------------
  // Execute transition
  // --------------------------------------------------

  const executeTransition = async (
    tx: DbTransaction,
  ): Promise<T> => {

    const updatedJobItem =
      await updateJobItem(tx);

    if (!updatedJobItem) {
      throw new Error(
        `Job item transition failed. Item may have already been changed from '${effectivePreviousStatus}'.`,
      );
    }

    // ------------------------------------------------
    // Status history
    // ------------------------------------------------

    await tx
      .insert(jobItemStatusHistory)
      .values({
        jobItemId,

        previousStatus:
          effectivePreviousStatus,

        newStatus,

        changedBy,

        note,
      });

    // ------------------------------------------------
    // Item comment
    // ------------------------------------------------

    if (note?.trim()) {
      await tx
        .insert(jobComments)
        .values({
          jobItemId,
          userId: changedBy,
          comment: note.trim(),
        });
    }

    return updatedJobItem;
  };

  // --------------------------------------------------
  // Existing transaction
  // --------------------------------------------------

  if (existingTx) {
    return executeTransition(existingTx);
  }

  // --------------------------------------------------
  // New transaction
  // --------------------------------------------------

  return db.transaction(async (tx) => {
    return executeTransition(tx);
  });
};