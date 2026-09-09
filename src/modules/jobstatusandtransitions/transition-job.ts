import {
  eq,
} from 'drizzle-orm';

import {
  jobs,
  jobComments,
  jobStatusHistory,
  JobSummaryStatus,
} from '../../db/schema/index.js';

import { db } from '../../config/database.js';

import { DbTransaction } from './item-status-history.js';
import { canTransitionJob } from './status-history.js';


// --------------------------------------------------
// Function parameters
// --------------------------------------------------

export interface TransitionJobParams<T> {
  jobId: string;

  previousStatus: JobSummaryStatus | null;

  newStatus: JobSummaryStatus;

  changedBy: string;

  note?: string;

  updateJob: (
    tx: DbTransaction,
  ) => Promise<T>;

  existingTx?: DbTransaction;
}


// --------------------------------------------------
// Reusable job transition
// --------------------------------------------------

export const transitionJob = async <T>({
  jobId,
  previousStatus,
  newStatus,
  changedBy,
  note,
  updateJob,
  existingTx,
}: TransitionJobParams<T>): Promise<T> => {

  // --------------------------------------------------
  // Resolve previous status
  // --------------------------------------------------

  // If there is no previous status,
  // treat the job as being in the "created" state.
  const effectivePreviousStatus =
    previousStatus ?? 'created';


  // --------------------------------------------------
  // Validate transition
  // --------------------------------------------------

  if (
    !canTransitionJob(
      effectivePreviousStatus,
      newStatus,
    )
  ) {
    throw new Error(
      `Invalid job status transition: ${effectivePreviousStatus} -> ${newStatus}`,
    );
  }


  // --------------------------------------------------
  // Execute transition
  // --------------------------------------------------

  const executeTransition = async (
    tx: DbTransaction,
  ): Promise<T> => {

    // Update job
    const updatedJob =
      await updateJob(tx);


    // --------------------------------------------------
    // Status history
    // --------------------------------------------------

    await tx
      .insert(jobStatusHistory)
      .values({
        jobId,

        // Never insert null.
        previousStatus:
          effectivePreviousStatus,

        newStatus,

        changedBy,

        note:
          note ??
          `Job status changed from ${effectivePreviousStatus} to ${newStatus}`,
      });


    // --------------------------------------------------
    // Job-level comment
    // --------------------------------------------------

    await tx
      .insert(jobComments)
      .values({
        jobId,

        jobItemId: null,

        userId: changedBy,

        comment:
          note ??
          `Job status changed from ${effectivePreviousStatus} to ${newStatus}`,
      });


    return updatedJob;
  };


  // --------------------------------------------------
  // Existing transaction
  // --------------------------------------------------

  if (existingTx) {
    return executeTransition(existingTx);
  }


  // --------------------------------------------------
  // Create new transaction
  // --------------------------------------------------

  return db.transaction(async (tx) => {
    return executeTransition(tx);
  });
};