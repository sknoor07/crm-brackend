import { eq } from "drizzle-orm";
import { jobComments } from "../../../db/schema/job-comments.js";
import { jobItemStatusHistory } from "../../../db/schema/job-item-status-history.js";
import { jobItems } from "../../../db/schema/job-items.js";
import { JobItemStatus, JobSummaryStatus } from "../../../db/schema/job-status.js";
import { buildQuoteLineValues, moneyString } from "../../jobs/quote-components.js";
import { CSApproveJobAndJobItemInput, CSApproveJobItemInput } from "../cs.validation.js";
import { jobs } from "../../../db/schema/jobs.js";
import { db } from "../../../config/database.js";
import { jobItemQuotes } from "../../../db/schema/job-item-quotes.js";
import { jobStatusHistory } from "../../../db/schema/job-status-history.js";
import { jobItemQuoteLines } from "../../../db/schema/job-item-quote-lines.js";

type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];


export const validateNoDuplicateJobItems = (items: CSApproveJobItemInput[],): void => {
    const ids = items.map((item) => item.jobItemId);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      throw new Error('Duplicate job item IDs are not allowed');
    }
  };
  
export const validateJobItemsBelongToJob = (submittedItems: CSApproveJobItemInput[],existingJobItems: typeof jobItems.$inferSelect[],): void => {
    const existingIds = new Set(existingJobItems.map((item) => item.id),);
  
    for (const item of submittedItems) {
      if (!existingIds.has(item.jobItemId)) {
        throw new Error(`Job item ${item.jobItemId} does not belong to this job`,);
      }
    }
  };

export const validateAllJobItemsSubmitted = (existingJobItems: typeof jobItems.$inferSelect[],submittedItems: CSApproveJobItemInput[],): void => {
    const submittedIds = new Set(submittedItems.map((item) => item.jobItemId),);
  
    const missingItems = existingJobItems.filter((item) => !submittedIds.has(item.id),);
  
    if (missingItems.length > 0) {
      throw new Error(`All job items must be included. Missing ${missingItems.length} job item(s).`);
    }
  };
  
export const createJobItemStatusHistory = async (
  tx: DbTransaction,
    params: {
      jobItemId: string;
      previousStatus: JobItemStatus | null;
      newStatus: JobItemStatus;
      changedBy: string;
      note: string;
    },
  ) => {
    await tx.insert(jobItemStatusHistory).values({
      jobItemId: params.jobItemId,
      previousStatus: params.previousStatus,
      newStatus: params.newStatus,
      changedBy: params.changedBy,
      note: params.note,
    });
  };
  
export const createJobItemComment = async (
    tx: DbTransaction,
    params: {
      jobItemId: string;
      userId: string;
      comment: string;
    },
  ) => {
    await tx.insert(jobComments).values({
      jobItemId: params.jobItemId,
      userId: params.userId,
      comment: params.comment,
    });
  };
  
export const recordJobItemTransition = async (
    tx: DbTransaction,
    params: {
      jobItemId: string;
      previousStatus: JobItemStatus | null;
      newStatus: JobItemStatus;
      changedBy: string;
      note: string;
    },
  ) => {
    await createJobItemStatusHistory(tx, params);
  
    await createJobItemComment(tx, {
      jobItemId: params.jobItemId,
      userId: params.changedBy,
      comment: params.note,
    });
  };
  
export const approveJobItemByCS = async (
    tx: DbTransaction,
    params: {
      jobItem: typeof jobItems.$inferSelect;
      input: CSApproveJobItemInput;
      changedBy: string;
    },
  ) => {
    const {jobItem,input,changedBy} = params;
  
    if (!input.estimatedComponents || input.estimatedComponents.length === 0
    ) {
      throw new Error(`Estimated components are required for job item ${jobItem.id}`);
    }
  
    const quoteValues = buildQuoteLineValues('estimate', input.estimatedComponents);
  
    const [updatedJobItem] = await tx
      .update(jobItems)
      .set({
        currentStatus: 'approved_for_transport',
        isApprovedByCS: true,
        estimatedComponentsCost: moneyString(quoteValues.componentsCost),
        updatedAt: new Date(),
      })
      .where(eq(jobItems.id, jobItem.id))
      .returning();
  
    if (!updatedJobItem) {
      throw new Error(`Failed to approve job item ${jobItem.id}`,);
    }
  
    await recordJobItemTransition(tx, {
      jobItemId: jobItem.id,
      previousStatus: jobItem.currentStatus,
      newStatus: 'approved_for_transport',
      changedBy,
      note: input.comment.trim(),
    });
  
    return {jobItem: updatedJobItem,quoteValues};
  };
  
  export const rejectJobItemByCS = async (
    tx: DbTransaction,
    params: {
      jobItem: typeof jobItems.$inferSelect;
      comment: string;
      changedBy: string;
    },
  ) => {
    const { jobItem, comment, changedBy } = params;
  
    const [updatedJobItem] = await tx
      .update(jobItems)
      .set({
        currentStatus: 'repair_rejected',
        isApprovedByCS: false,
        updatedAt: new Date(),
      })
      .where(eq(jobItems.id, jobItem.id))
      .returning();
  
    if (!updatedJobItem) {
      throw new Error(
        `Failed to reject job item ${jobItem.id}`,
      );
    }
  
    await recordJobItemTransition(tx, {
      jobItemId: jobItem.id,
      previousStatus: jobItem.currentStatus,
      newStatus: 'repair_rejected',
      changedBy,
      note: comment.trim(),
    });
  
    return {
      jobItem: updatedJobItem,
      quoteValues: null,
    };
  };
  
export const processJobItemForCS = async (
    tx: DbTransaction,
    params: {
      jobItem: typeof jobItems.$inferSelect;
      input: CSApproveJobItemInput;
      changedBy: string;
    },
  ) => {
    const {jobItem,input,changedBy,} = params;
  
    if (
      jobItem.currentStatus !== 'pending_cs_verification'
    ) {
      throw new Error(
        `Job item ${jobItem.id} is not pending CS verification`,
      );
    }
  
    /*
     * No decision means approved.
     */
    const decision = input.decision ?? 'approved';
  
    if (decision === 'approved') {
      return approveJobItemByCS(tx, {
        jobItem,
        input,
        changedBy,
      });
    }
  
    return rejectJobItemByCS(tx, {
      jobItem,
      comment: input.comment,
      changedBy,
    });
  };
  
export const recordJobTransition = async (
    tx: DbTransaction,
    params: {
      jobId: string;
      previousStatus: JobSummaryStatus | null;
      newStatus: JobSummaryStatus;
      changedBy: string;
      note: string;
    },
  ) => {
    await tx.insert(jobStatusHistory).values({
      jobId: params.jobId,
  
      previousStatus: params.previousStatus,
  
      newStatus: params.newStatus,
  
      changedBy: params.changedBy,
  
      note: params.note,
    });
  };
  
  const JOB_STATUS_AFTER_CS_APPROVAL = 'approved_for_transport' as JobSummaryStatus;
  
  export const updateJobAfterCSApproval = async (
    tx: DbTransaction,
    params: {
      job: typeof jobs.$inferSelect;
    },
  ) => {
    const [updatedJob] = await tx
      .update(jobs)
      .set({
        isApprovedByCS: true,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, params.job.id))
      .returning();
  
    if (!updatedJob) {
      throw new Error(
        `Failed to update job ${params.job.id}`,
      );
    }
  
    return updatedJob;
  };
export const rejectJobByCS = async (
    tx: DbTransaction,
    params: {
      job: typeof jobs.$inferSelect;
      changedBy: string;
      comment: string;
    },
  ) => {
    const [updatedJob] = await tx
      .update(jobs)
      .set({
        isApprovedByCS: false,
  
        currentStatus: 'cancelled',
  
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, params.job.id))
      .returning();
  
    if (!updatedJob) {
      throw new Error(
        `Failed to reject job ${params.job.id}`,
      );
    }
  
    await recordJobTransition(tx, {
      jobId: params.job.id,
  
      previousStatus: params.job.currentStatus,
  
      newStatus: 'cancelled',
  
      changedBy: params.changedBy,
  
      note: params.comment.trim(),
    });
  
    return updatedJob;
  };

const createJobItemInputMap = (items: CSApproveJobItemInput[]): Map<string, CSApproveJobItemInput> => {
    return new Map(
      items.map((item) => [item.jobItemId, item]),
    );
  };
  
export const processCSJobApproval = async (input: CSApproveJobAndJobItemInput,csUserId: string,) => {
    return db.transaction(async (tx) => {
      /*
       * --------------------------------------------------
       * 1. Get the job
       * --------------------------------------------------
       */
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, input.jobId)).limit(1);
      if (!job) {
        throw new Error('Job not found');
      }
  
      /*
       * --------------------------------------------------
       * 2. Get every item belonging to the job
       * --------------------------------------------------
       */
      const existingJobItems = await tx.select().from(jobItems).where(eq(jobItems.jobId, job.id));
      if (existingJobItems.length === 0) {
        throw new Error('Job does not contain any job items',);
      }
  
      /*
       * --------------------------------------------------
       * 3. Validate request
       * --------------------------------------------------
       */
      validateNoDuplicateJobItems(input.items);
  
      validateJobItemsBelongToJob(input.items,existingJobItems,);
  
      validateAllJobItemsSubmitted(existingJobItems,input.items,);
  
      const itemInputMap = createJobItemInputMap(input.items,);
  
      /*
       * --------------------------------------------------
       * CASE 3
       *
       * Whole job rejected
       * --------------------------------------------------
       */
  
      if (!input.isApprovedByCS) {
        const processedItems = [];
  
        for (const jobItem of existingJobItems) {
          const itemInput = itemInputMap.get(jobItem.id,);
  
          const itemComment =itemInput?.comment?.trim() || input.comment.trim();
  
          const result = await rejectJobItemByCS(
            tx,
            {
              jobItem,
              comment: itemComment,
              changedBy: csUserId,
            },
          );
  
          processedItems.push(result);
        }
  
        const updatedJob = await rejectJobByCS(
          tx,
          {
            job,
            changedBy: csUserId,
            comment: input.comment,
          },
        );
  
        return {
          job: updatedJob,
          jobItems: processedItems,
        };
      }
  
      /*
       * --------------------------------------------------
       * CASE 1 + CASE 2
       *
       * Whole job approved
       * --------------------------------------------------
       */
  
      const processedItems = [];
      const allComponents = [];
      for (const jobItem of existingJobItems) {
        const itemInput = itemInputMap.get(jobItem.id,);
        if (!itemInput) {
          throw new Error(`Missing input for job item ${jobItem.id}`,);
        }

        /*
         * undefined decision = approved
         */
        const result = await processJobItemForCS(
          tx,
          {
            jobItem,
            input: itemInput,
            changedBy: csUserId,
          },
        );
  
        processedItems.push(result);
        if (result.quoteValues) {
            allComponents.push(
              ...itemInput.estimatedComponents!,
            );
          }
      }


    let quote = null;
    let quoteLines: typeof jobItemQuoteLines.$inferInsert[] = [];
    if(allComponents.length>0){
        const quoteValues = buildQuoteLineValues('preview',allComponents);
        const [createdQuote] = await tx
        .insert(jobItemQuotes)
        .values({
          // This needs to be changed depending on
          // how you want the quote related to the job.
          // A jobItemId is required by your current schema.
          jobItemId: existingJobItems[0].id,

          version: 1,

          componentsCost: moneyString(quoteValues.componentsCost,),
          serviceCharge: '0.00',

          totalAmount: moneyString(quoteValues.componentsCost,),

          createdByUserId: csUserId,

          customerApproved: null,
          customerRespondedAt: null,

          status: 'pending_customer_approval',
        }).returning();

        if (!createdQuote) {
            throw new Error(
              'Failed to create job item quote',
            );
          }
    
          quote = createdQuote;
          quoteLines = quoteValues.lines.map((line) => ({
            ...line,
            quoteId: createdQuote.id,
          }));
          await tx
            .insert(jobItemQuoteLines)
            .values(quoteLines);
        }
    

    // --------------------------------------------------
    // Update parent job
    // --------------------------------------------------

    const updatedJob =
      await updateJobAfterCSApproval(
        tx,
        {
          job,
        },
      );

    return {
      job: updatedJob,
      jobItems: processedItems,
      quote,
      quoteLines,
    };
  });
};