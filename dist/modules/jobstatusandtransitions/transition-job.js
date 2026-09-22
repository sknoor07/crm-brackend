import { jobComments, jobStatusHistory, } from '../../db/schema/index.js';
import { db } from '../../config/database.js';
import { canTransitionJob } from './status-history.js';
// --------------------------------------------------
// Reusable job transition
// --------------------------------------------------
export const transitionJob = async ({ jobId, previousStatus, newStatus, changedBy, note, comment, updateJob, existingTx, }) => {
    // --------------------------------------------------
    // Resolve previous status
    // --------------------------------------------------
    // If there is no previous status,
    // treat the job as being in the "created" state.
    const effectivePreviousStatus = previousStatus ?? 'created';
    // --------------------------------------------------
    // Validate transition
    // --------------------------------------------------
    if (!canTransitionJob(effectivePreviousStatus, newStatus)) {
        throw new Error(`Invalid job status transition: ${effectivePreviousStatus} -> ${newStatus}`);
    }
    // --------------------------------------------------
    // Execute transition
    // --------------------------------------------------
    const executeTransition = async (tx) => {
        // Update job
        const updatedJob = await updateJob(tx);
        // --------------------------------------------------
        // Status history
        // --------------------------------------------------
        await tx
            .insert(jobStatusHistory)
            .values({
            jobId,
            // Never insert null.
            previousStatus: effectivePreviousStatus,
            newStatus,
            changedBy,
            note: note ??
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
            comment: comment ??
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
