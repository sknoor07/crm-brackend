import { db } from '../../config/database.js';
import { jobStatusHistory, JobStatus } from '../../db/schema/index.js';

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const allowedJobTransitions: Record<JobStatus | 'created', readonly JobStatus[]> = {
  created: ['pending_cs_verification', 'ready_for_pickup'],
  pending_cs_verification: ['ready_for_pickup'],
  ready_for_pickup: ['pending_pickup'],
  pending_pickup: ['pending_final_quote', 'in_transit_to_lab'],
  pending_final_quote: ['awaiting_customer_approval'],
  awaiting_customer_approval: ['repair_in_progress', 'repair_rejected'],
  repair_in_progress: ['repair_completed'],
  in_transit_to_lab: ['arrived_at_lab'],
  arrived_at_lab: ['in_lab_diagnosis'],
  in_lab_diagnosis: ['pending_final_quote'],
  repair_completed: ['out_for_delivery', 'closed'],
  out_for_delivery: ['delivered'],
  delivered: ['closed'],
  closed: [],
  repair_rejected: ['closed'],
  cancelled: ['closed'],
};

export const updateJobWithStatusTransition = async <T>(
  jobId: string,
  previousStatus: JobStatus | null,
  newStatus: JobStatus,
  updateJob: (tx: DbTransaction) => Promise<T>,
  changedBy?: string,
  note?: string,
) => {
  const transitionKey = previousStatus || 'created';
  if (!allowedJobTransitions[transitionKey].includes(newStatus)) {
    throw new Error(`Invalid job status transition: ${transitionKey} -> ${newStatus}`);
  }

  return db.transaction(async (tx) => {
    const updatedJob = await updateJob(tx);

    await tx.insert(jobStatusHistory).values({
      jobId,
      previousStatus,
      newStatus,
      changedBy,
      note,
    });

    return updatedJob;
  });
};
