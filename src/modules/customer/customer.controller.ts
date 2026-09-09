import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../../config/database.js';

import {jobs,jobItems,jobComments,deviceServiceCharges, jobItemStatusHistory, jobStatusHistory,} from '../../db/schema/index.js';

import { generateJobNumber } from '../../shared/utils/jobNumber.js';

import {updateJobItemWithStatusTransition,} from '../jobstatusandtransitions/item-status-history.js';

import {CreateCustomerJobInput,CreateCustomerJobItemSchema, QuoteResponseInput} from './customer.validation.js';
import { transitionJob } from '../jobstatusandtransitions/transition-job.js';


/**
customer will create a job will multiple job items.
 */
export const createCustomerJob = async (
  req: Request<{}, {}, CreateCustomerJobInput>,
  res: Response,
) => {
  try {
    const { items, comment } = req.body;

    const customerId = req.user?.userId;

    if (!customerId) {
      return res.status(401).json({
        error: 'Authenticated customer is required',
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'At least one job item is required',
      });
    }

    const jobId = crypto.randomUUID();
    const jobNumber = generateJobNumber();

    const result = await db.transaction(async (tx) => {

      // --------------------------------------------------
      // 1. CREATE JOB
      // --------------------------------------------------

      const [job] = await tx
        .insert(jobs)
        .values({
          id: jobId,
          jobNumber,
          customerId,
          currentStatus: 'created',
        })
        .returning();


      // --------------------------------------------------
      // 2. JOB COMMENT
      // --------------------------------------------------

      if (comment?.trim()) {
        await tx
          .insert(jobComments)
          .values({
            jobId: job.id,
            jobItemId: null,
            userId: customerId,
            comment: comment.trim(),
          });
      }


      // --------------------------------------------------
      // 3. CREATE JOB ITEMS
      // --------------------------------------------------

      const jobItemsToInsert = items.map((item) => ({
        id: crypto.randomUUID(),
        jobId: job.id,
        deviceCategory: item.deviceCategory,
        deviceSerialNumber: item.deviceSerialNumber,
        issueDescription: item.issueDescription,
        currentStatus: 'created' as const,
      }));

      const createdJobItems = await tx
        .insert(jobItems)
        .values(jobItemsToInsert)
        .returning();


      // --------------------------------------------------
      // 4. JOB TRANSITION
      // created -> in_progress
      // --------------------------------------------------

      const updatedJob = await transitionJob({
        jobId: job.id,
        previousStatus: 'created',
        newStatus: 'in_progress',
        changedBy: customerId,
        note: 'Job submitted and moved to in progress',
        existingTx: tx,

        updateJob: async (tx) => {
          const [updated] = await tx
            .update(jobs)
            .set({
              currentStatus: 'in_progress',
              updatedAt: new Date(),
            })
            .where(eq(jobs.id, job.id))
            .returning();

          return updated;
        },
      });


      // --------------------------------------------------
      // 5. JOB ITEM TRANSITIONS
      // created -> pending_cs_verification
      // --------------------------------------------------

      const updatedJobItems = [];

      for (const item of createdJobItems) {
        const updatedItem =
          await updateJobItemWithStatusTransition(
            item.id,
            'created',
            'pending_cs_verification',

            async (tx) => {
              const [updated] = await tx
                .update(jobItems)
                .set({
                  currentStatus:
                    'pending_cs_verification',
                  updatedAt: new Date(),
                })
                .where(eq(jobItems.id, item.id))
                .returning();

              return updated;
            },

            customerId,
            'Job item submitted and awaiting CS verification',
            tx,
          );

        updatedJobItems.push(updatedItem);
      }


      return {
        job: updatedJob,
        jobItems: updatedJobItems,
      };
    });


    return res.status(201).json({
      message:
        'Repair request submitted successfully. It is awaiting CS verification.',

      job: result.job,

      jobItems: result.jobItems,
    });

  } catch (error) {
    console.error(
      'Customer Job Creation Error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while creating repair request',
    });
  }
};

/**
 * ============================================================
 * CUSTOMER - RESPOND TO FINAL QUOTE
 * ============================================================
 *
 * Quote workflow:
 *
 * awaiting_customer_approval
 *             ↓
 *       ┌─────┴─────┐
 *       ↓           ↓
 *    accept       reject
 *       ↓           ↓
 * repair_in_progress
 *                   repair_rejected
 *
 * The JOB itself remains:
 *
 *     in_progress
 *
 * Only the JOB ITEM changes status.
 */
export const respondToQuote = async (req: Request<{},{},QuoteResponseInput>,res: Response,) => {
  try {
    const {jobItemId,decision,comment,} = req.body;

    const userId =req.user?.userId;

    if (!userId) {
      return res.status(401).json({error:'Authentication required',});
    }


    /* ---------------------------------------------------------
       Find the specific repair item
       --------------------------------------------------------- */

    const [jobItem] =
      await db
        .select({id: jobItems.id,
          jobId:jobItems.jobId,
          currentStatus:jobItems.currentStatus,
          isFinalQuoteApproved:jobItems.isFinalQuoteApproved,
        })
        .from(jobItems)
        .where(eq(jobItems.id,jobItemId,),)
        .limit(1);

    if (!jobItem) {
      return res.status(404).json({error:'Job item not found',});
    }


    /* ---------------------------------------------------------
       Find parent job
       --------------------------------------------------------- */

    const [job] =
      await db
        .select({id: jobs.id,customerId:jobs.customerId,})
        .from(jobs)
        .where(
          eq(jobs.id,jobItem.jobId))
        .limit(1);

    if (!job) {
      return res.status(404).json({error:'Job not found',});
    }


    /* ---------------------------------------------------------
       Verify customer ownership
       --------------------------------------------------------- */

    const roles =req.user?.roles ?? [];

    /*
     * Admin/employee users may be allowed through the route
     * depending on the application's authorization rules.
     *
     * A normal customer can only respond to their own job.
     */
    if (roles.includes('customer') &&job.customerId !== userId) {
      return res.status(403).json({error:'You can only respond to quotes for your own jobs'});
    }


    /* ---------------------------------------------------------
       Validate current item status
       --------------------------------------------------------- */

    if (jobItem.currentStatus !=='awaiting_customer_approval') {
      return res.status(400).json({error:`Cannot respond to quote. Job item is currently in '${jobItem.currentStatus}' state.`});
    }


    /* ---------------------------------------------------------
       Determine new item status
       --------------------------------------------------------- */

    const newStatus =decision === 'accept'? 'repair_authorized': 'repair_rejected';


    /**
     * IMPORTANT:
     *
     * Customer acceptance should first move the item to:
     *
     *     repair_authorized
     *
     * Then the appropriate repair/transport person explicitly
     * starts the repair:
     *
     *     repair_authorized
     *             ↓
     *     repair_in_progress
     *
     * This follows the workflow defined for the project.
     */


    /* ---------------------------------------------------------
       Update item and create status history/comment
       --------------------------------------------------------- */

    const updatedJobItem =
      await updateJobItemWithStatusTransition(jobItem.id,jobItem.currentStatus,newStatus,
        async (tx) => {
          const [result] =
            await tx.update(jobItems)
              .set({currentStatus:newStatus,
                isFinalQuoteApproved:decision === 'accept',
                updatedAt:new Date(),
              })
              .where(eq(jobItems.id,jobItem.id,),)
              .returning();


          /* ---------------------------------------------------
             Customer comment is optional.
             --------------------------------------------------- */

          if (comment?.trim()) {
            await tx
              .insert(jobComments)
              .values({jobItemId:jobItem.id,userId,comment:comment.trim()});
          }
          return result;
        },
        userId,

        /*
         * Mandatory workflow-action comment.
         *
         * The helper stores this in job_comments and
         * job_item_status_history.
         */
        decision === 'accept'? 'Customer approved the final quote.': 'Customer rejected the final quote.');


    return res.status(200).json({
      message:decision === 'accept'? 'Quote accepted successfully. Repair is now authorized.': 'Quote rejected successfully.',
      jobItem:updatedJobItem,
    });
  } catch (error) {console.error('Quote response error:',error,);

    return res.status(500).json({error:'Internal server error while responding to quote',});
  }
};