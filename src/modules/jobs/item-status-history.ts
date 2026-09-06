import { db } from '../../config/database.js';

import {
  JobItemStatus,
  jobComments,
  jobItemStatusHistory,
} from '../../db/schema/index.js';

type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export const allowedJobItemTransitions: Record<
  string,
  JobItemStatus[]
> = {
  created: [
    'pending_cs_verification',
  ],

  pending_cs_verification: [
    'approved_for_transport',
    'repair_rejected',
  ],

  approved_for_transport: [
    'transport_inspection',
  ],

  transport_inspection: [
    'pending_final_quote_onsite',
    'pending_lab_receipt',
    'repair_rejected',
  ],

  pending_final_quote_onsite: [
    'awaiting_customer_approval',
    'repair_rejected',
  ],

  pending_lab_receipt: [
    'received_at_lab',
  ],

  received_at_lab: [
    'pending_repair_assignment',
  ],

  pending_repair_assignment: [
    'assigned_to_repair_person',
  ],

  assigned_to_repair_person: [
    'diagnosis_in_progress',
  ],

  diagnosis_in_progress: [
    'pending_final_quote',
    'repair_rejected',
  ],

  pending_final_quote: [
    'awaiting_customer_approval',
    'repair_rejected',
  ],

  awaiting_customer_approval: [
    'repair_authorized',
    'pending_final_quote',
    'repair_rejected',
  ],

  repair_authorized: [
    'repair_in_progress',
  ],

  repair_in_progress: [
    'pending_repair_manager_inspection',
    'pending_cs_confirmation',
  ],

  pending_repair_manager_inspection: [
    'ready_for_delivery',
    'repair_in_progress',
  ],

  pending_cs_confirmation: [
    'ready_for_delivery',
  ],

  ready_for_delivery: [
    'out_for_delivery',
  ],

  out_for_delivery: [
    'delivered',
  ],

  delivered: [],

  repair_rejected: [],

  cancelled: [],
};

export const updateJobItemWithStatusTransition = async <T>(
  jobItemId: string,
  previousStatus: JobItemStatus | null,
  newStatus: JobItemStatus,
  updateJobItem: (tx: any) => Promise<T>,
  changedBy: string,
  note: string,
  existingTx?: any,
): Promise<T> => {

  const transitionKey = previousStatus ?? 'created';

  if (!allowedJobItemTransitions[transitionKey]?.includes(newStatus)) {
    throw new Error(
      `Invalid job item status transition: ${transitionKey} -> ${newStatus}`
    );
  }

  const executeTransition = async (tx: any): Promise<T> => {

    const updatedJobItem = await updateJobItem(tx);

    await tx.insert(jobItemStatusHistory).values({
      jobItemId,
      previousStatus,
      newStatus,
      changedBy,
      note,
    });

    await tx.insert(jobComments).values({
      jobItemId,
      userId: changedBy,
      comment: note,
    });

    return updatedJobItem;
  };

  /*
   * If a transaction was already created by the caller,
   * use that transaction.
   */
  if (existingTx) {
    return executeTransition(existingTx);
  }

  /*
   * Otherwise create a new transaction.
   */
  return db.transaction(async (tx) => {
    return executeTransition(tx);
  });
};