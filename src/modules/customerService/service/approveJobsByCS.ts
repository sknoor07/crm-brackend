import { desc, eq } from 'drizzle-orm';

import { db } from '../../../config/database.js';

import { jobs } from '../../../db/schema/jobs.js';
import { jobComments } from '../../../db/schema/job-comments.js';
import { jobItems } from '../../../db/schema/job-items.js';
import { jobItemQuotes } from '../../../db/schema/job-item-quotes.js';
import { jobItemQuoteLines } from '../../../db/schema/job-item-quote-lines.js';
import { jobItemStatusHistory } from '../../../db/schema/job-item-status-history.js';

import {
  JobItemStatus,
  JobSummaryStatus,
} from '../../../db/schema/job-status.js';

import {
  buildQuoteLineValues,
  moneyString,
} from '../../jobs/quote-components.js';

import {
  CSApproveJobAndJobItemInput,
  CSApproveJobItemInput,
} from '../cs.validation.js';
import { updateJobItemWithStatusTransition } from '../../jobstatusandtransitions/item-status-history.js';
import { transitionJob } from '../../jobstatusandtransitions/transition-job.js';



// --------------------------------------------------
// Database transaction type
// --------------------------------------------------

type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];


// --------------------------------------------------
// Validate duplicate job items
// --------------------------------------------------

export const validateNoDuplicateJobItems = (
  items: CSApproveJobItemInput[],
): void => {
  const ids = items.map(
    (item) => item.jobItemId,
  );

  const uniqueIds = new Set(ids);

  if (uniqueIds.size !== ids.length) {
    throw new Error(
      'Duplicate job item IDs are not allowed',
    );
  }
};


// --------------------------------------------------
// Validate job items belong to job
// --------------------------------------------------

export const validateJobItemsBelongToJob = (
  submittedItems: CSApproveJobItemInput[],
  existingJobItems: typeof jobItems.$inferSelect[],
): void => {
  const existingIds = new Set(
    existingJobItems.map(
      (item) => item.id,
    ),
  );

  for (const item of submittedItems) {
    if (!existingIds.has(item.jobItemId)) {
      throw new Error(
        `Job item ${item.jobItemId} does not belong to this job`,
      );
    }
  }
};


// --------------------------------------------------
// Validate every job item was submitted
// --------------------------------------------------

export const validateAllJobItemsSubmitted = (
  existingJobItems: typeof jobItems.$inferSelect[],
  submittedItems: CSApproveJobItemInput[],
): void => {
  const submittedIds = new Set(
    submittedItems.map(
      (item) => item.jobItemId,
    ),
  );

  const missingItems =
    existingJobItems.filter(
      (item) => !submittedIds.has(item.id),
    );

  if (missingItems.length > 0) {
    throw new Error(
      `All job items must be included. Missing ${missingItems.length} job item(s).`,
    );
  }
};


// --------------------------------------------------
// Get service charge
// --------------------------------------------------

const getServiceCharge = async (
  deviceCategory: string,
  tx: DbTransaction,
): Promise<number> => {
  const { deviceServiceCharges } =
    await import(
      '../../../db/schema/device-service-charges.js'
    );

  const [serviceCharge] =
    await tx
      .select()
      .from(deviceServiceCharges)
      .where(
        eq(
          deviceServiceCharges.deviceCategory,
          deviceCategory,
        ),
      )
      .limit(1);

  if (!serviceCharge) {
    throw new Error(
      `No service charge configured for device category '${deviceCategory}'`,
    );
  }

  return Number(
    serviceCharge.chargeAmount,
  );
};


// --------------------------------------------------
// Calculate service charge based on repair location
// --------------------------------------------------

const calculateServiceCharge = async (
  jobItem: typeof jobItems.$inferSelect,
  tx: DbTransaction,
): Promise<number> => {

  // Onsite repairs have no service charge.
  if (
    jobItem.repairLocation ===
    'customer_site'
  ) {
    return 0;
  }

  // Lab repairs use configured device-category charge.
  return getServiceCharge(
    jobItem.deviceCategory,
    tx,
  );
};


// --------------------------------------------------
// Approve individual job item
// --------------------------------------------------

export const approveJobItemByCS = async (
  tx: DbTransaction,
  params: {
    jobItem: typeof jobItems.$inferSelect;
    input: CSApproveJobItemInput;
    changedBy: string;
  },
) => {
  const {
    jobItem,
    input,
    changedBy,
  } = params;


  // ------------------------------------------------
  // Validate estimated components
  // ------------------------------------------------

  if (
    input.estimatedComponents.length === 0
  ) {
    throw new Error(
      `Estimated components are required for job item ${jobItem.id}`,
    );
  }


  // ------------------------------------------------
  // Build quote lines
  // ------------------------------------------------

  const quoteValues =
    buildQuoteLineValues(
      'estimate',
      input.estimatedComponents,
    );


  // ------------------------------------------------
  // Calculate service charge
  // ------------------------------------------------

  const serviceChargeAmount =
    await calculateServiceCharge(
      jobItem,
      tx,
    );

  const totalAmount =
    quoteValues.componentsCost +
    serviceChargeAmount;


  // ------------------------------------------------
  // Update job item through transition helper
  // ------------------------------------------------

  const result =
    await updateJobItemWithStatusTransition(
      jobItem.id,

      jobItem.currentStatus,

      'approved_for_transport',

      async (transaction:DbTransaction) => {
        const [updatedJobItem] =
          await transaction
            .update(jobItems)
            .set({
              currentStatus:
                'approved_for_transport',

              isApprovedByCS:
                true,

              estimatedComponentsCost:
                moneyString(
                  quoteValues.componentsCost,
                ),

              updatedAt:
                new Date(),
            })
            .where(
              eq(
                jobItems.id,
                jobItem.id,
              ),
            )
            .returning();

        if (!updatedJobItem) {
          throw new Error(
            `Failed to approve job item ${jobItem.id}`,
          );
        }

        return updatedJobItem;
      },

      changedBy,

      input.comment.trim(),

      tx,
    );


  // ------------------------------------------------
  // Get latest quote version
  // ------------------------------------------------

  const [latestQuote] =
    await tx
      .select()
      .from(jobItemQuotes)
      .where(
        eq(
          jobItemQuotes.jobItemId,
          jobItem.id,
        ),
      )
      .orderBy(
        desc(
          jobItemQuotes.version,
        ),
      )
      .limit(1);

  const nextVersion =
    (latestQuote?.version ?? 0) + 1;


  // ------------------------------------------------
  // Create estimated quote
  // ------------------------------------------------

  const [quote] =
    await tx
      .insert(jobItemQuotes)
      .values({
        jobItemId:
          jobItem.id,

        version:
          nextVersion,

        componentsCost:
          moneyString(
            quoteValues.componentsCost,
          ),

        serviceCharge:
          moneyString(
            serviceChargeAmount,
          ),

        totalAmount:
          moneyString(
            totalAmount,
          ),

        createdByUserId:
          changedBy,

        customerApproved:
          null,

        customerRespondedAt:
          null,

        status:
          'estimated',
      })
      .returning();

  if (!quote) {
    throw new Error(
      `Failed to create estimated quote for job item ${jobItem.id}`,
    );
  }


  // ------------------------------------------------
  // Create quote lines
  // ------------------------------------------------

  if (quoteValues.lines.length > 0) {
    await tx
      .insert(jobItemQuoteLines)
      .values(
        quoteValues.lines.map(
          (line) => ({
            ...line,
            quoteId: quote.id,
          }),
        ),
      );
  }


  return {
    jobItem:
      result,

    quote,

    quoteValues,
  };
};


// --------------------------------------------------
// Reject individual job item
// --------------------------------------------------

export const rejectJobItemByCS = async (
  tx: DbTransaction,
  params: {
    jobItem: typeof jobItems.$inferSelect;
    comment: string;
    changedBy: string;
  },
) => {
  const {
    jobItem,
    comment,
    changedBy,
  } = params;


  // ------------------------------------------------
  // Update job item through transition helper
  // ------------------------------------------------

  const updatedJobItem =
    await updateJobItemWithStatusTransition(
      jobItem.id,

      jobItem.currentStatus,

      'repair_rejected',

      async (transaction:DbTransaction) => {
        const [updated] =
          await transaction
            .update(jobItems)
            .set({
              currentStatus:
                'repair_rejected',

              isApprovedByCS:
                false,

              updatedAt:
                new Date(),
            })
            .where(
              eq(
                jobItems.id,
                jobItem.id,
              ),
            )
            .returning();

        if (!updated) {
          throw new Error(
            `Failed to reject job item ${jobItem.id}`,
          );
        }

        return updated;
      },

      changedBy,

      comment.trim(),

      tx,
    );


  return {
    jobItem:
      updatedJobItem,

    quote:
      null,

    quoteValues:
      null,
  };
};


// --------------------------------------------------
// Process one item according to CS decision
// --------------------------------------------------

export const processJobItemForCS = async (
  tx: DbTransaction,
  params: {
    jobItem: typeof jobItems.$inferSelect;
    input: CSApproveJobItemInput;
    changedBy: string;
  },
) => {
  const {
    jobItem,
    input,
    changedBy,
  } = params;


  // ------------------------------------------------
  // Validate current status
  // ------------------------------------------------

  if (
    jobItem.currentStatus !==
    'pending_cs_verification'
  ) {
    throw new Error(
      `Job item ${jobItem.id} is not pending CS verification`,
    );
  }


  // ------------------------------------------------
  // Approved
  // ------------------------------------------------

  if (
    input.decision ===
    'approved'
  ) {
    return approveJobItemByCS(
      tx,
      {
        jobItem,
        input,
        changedBy,
      },
    );
  }


  // ------------------------------------------------
  // Rejected
  // ------------------------------------------------

  return rejectJobItemByCS(
    tx,
    {
      jobItem,

      comment:
        input.comment,

      changedBy,
    },
  );
};


// --------------------------------------------------
// Reject entire job
// --------------------------------------------------

export const rejectJobByCS = async (
  tx: DbTransaction,
  params: {
    job: typeof jobs.$inferSelect;
    changedBy: string;
    comment: string;
  },
) => {
  const {
    job,
    changedBy,
    comment,
  } = params;


  // ------------------------------------------------
  // Transition job
  // ------------------------------------------------

  return transitionJob({
    jobId:
      job.id,

    previousStatus:
      job.currentStatus,

    newStatus:
      'cancelled',

    changedBy,

    note:
      comment.trim(),

    existingTx:
      tx,

    updateJob:
      async (transaction:DbTransaction) => {
        const [updatedJob] =
          await transaction
            .update(jobs)
            .set({
              currentStatus:
                'cancelled',

              isApprovedByCS:
                false,

              updatedAt:
                new Date(),
            })
            .where(
              eq(
                jobs.id,
                job.id,
              ),
            )
            .returning();

        if (!updatedJob) {
          throw new Error(
            `Failed to reject job ${job.id}`,
          );
        }

        return updatedJob;
      },
  });
};


// --------------------------------------------------
// Approve job after at least one item is approved
// --------------------------------------------------

export const approveJobByCS = async (
  tx: DbTransaction,
  params: {
    job: typeof jobs.$inferSelect;
    changedBy: string;
    comment: string;
  },
) => {
  const {
    job,
    changedBy,
    comment,
  } = params;


  // ------------------------------------------------
  // Transition job
  // ------------------------------------------------

  return transitionJob({
    jobId:
      job.id,

    previousStatus:
      job.currentStatus,

    newStatus:
      'assigning_pickup_Engineer',

    changedBy,

    note:
      comment.trim(),

    existingTx:
      tx,

    updateJob:
      async (transaction: DbTransaction) => {
        const [updatedJob] =
          await transaction
            .update(jobs)
            .set({
              currentStatus:
                'assigning_pickup_Engineer',

              isApprovedByCS:
                true,

              updatedAt:
                new Date(),
            })
            .where(
              eq(
                jobs.id,
                job.id,
              ),
            )
            .returning();

        if (!updatedJob) {
          throw new Error(
            `Failed to approve job ${job.id}`,
          );
        }

        return updatedJob;
      },
  });
};


// --------------------------------------------------
// Create item input map
// --------------------------------------------------

const createJobItemInputMap = (
  items: CSApproveJobItemInput[],
): Map<
  string,
  CSApproveJobItemInput
> => {
  return new Map(
    items.map(
      (item) => [
        item.jobItemId,
        item,
      ],
    ),
  );
};


// --------------------------------------------------
// Process complete CS job review
// --------------------------------------------------

export const processCSJobApproval = async (
  input: CSApproveJobAndJobItemInput,
  csUserId: string,
) => {

  return db.transaction(
    async (tx) => {

      // ----------------------------------------------
      // 1. Get job
      // ----------------------------------------------

      const [job] =
        await tx
          .select()
          .from(jobs)
          .where(
            eq(
              jobs.id,
              input.jobId,
            ),
          )
          .limit(1);

      if (!job) {
        throw new Error(
          'Job not found',
        );
      }


      // ----------------------------------------------
      // 2. Validate job state
      // ----------------------------------------------

      if (
        job.currentStatus ===
        'cancelled'
      ) {
        throw new Error(
          'Cancelled jobs cannot be reviewed by CS',
        );
      }


      // ----------------------------------------------
      // 3. Get all job items
      // ----------------------------------------------

      const existingJobItems =
        await tx
          .select()
          .from(jobItems)
          .where(
            eq(
              jobItems.jobId,
              job.id,
            ),
          );

      if (
        existingJobItems.length === 0
      ) {
        throw new Error(
          'Job does not contain any job items',
        );
      }


      // ----------------------------------------------
      // 4. Validate submitted items
      // ----------------------------------------------

      validateNoDuplicateJobItems(
        input.items,
      );

      validateJobItemsBelongToJob(
        input.items,
        existingJobItems,
      );

      validateAllJobItemsSubmitted(
        existingJobItems,
        input.items,
      );


      // ----------------------------------------------
      // 5. Create lookup map
      // ----------------------------------------------

      const itemInputMap =
        createJobItemInputMap(
          input.items,
        );


      // ----------------------------------------------
      // 6. Determine overall decision
      // ----------------------------------------------

      const hasApprovedItem =
        input.items.some(
          (item) =>
            item.decision ===
            'approved',
        );


      // ----------------------------------------------
      // 7. Process EVERY job item
      // ----------------------------------------------

      const processedItems = [];

      for (
        const jobItem
        of existingJobItems
      ) {

        const itemInput =
          itemInputMap.get(
            jobItem.id,
          );

        if (!itemInput) {
          throw new Error(
            `Missing input for job item ${jobItem.id}`,
          );
        }

        const result =
          await processJobItemForCS(
            tx,
            {
              jobItem,

              input:
                itemInput,

              changedBy:
                csUserId,
            },
          );

        processedItems.push(
          result,
        );
      }


      // ----------------------------------------------
      // 8. All items rejected
      // ----------------------------------------------

      if (!hasApprovedItem) {

        const updatedJob =
          await rejectJobByCS(
            tx,
            {
              job,

              changedBy:
                csUserId,

              comment:
                input.comment,
            },
          );

        return {
          job:
            updatedJob,

          jobItems:
            processedItems,

          decision:
            'rejected' as const,
        };
      }


      // ----------------------------------------------
      // 9. At least one item approved
      // ----------------------------------------------

      const updatedJob =
        await approveJobByCS(
          tx,
          {
            job,

            changedBy:
              csUserId,

            comment:
              input.comment,
          },
        );


      // ----------------------------------------------
      // 10. Return result
      // ----------------------------------------------

      return {
        job:
          updatedJob,

        jobItems:
          processedItems,

        decision:
          'approved' as const,
      };
    },
  );
};