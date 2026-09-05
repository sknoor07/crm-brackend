import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../../config/database.js';

import {
  jobs,
  jobItems,
  jobComments,
  deviceServiceCharges,
} from '../../db/schema/index.js';

import { generateJobNumber } from '../../shared/utils/jobNumber.js';

import {
  updateJobItemWithStatusTransition,
} from '../jobs/item-status-history.js';

import {
  CreateCustomerJobInput,
  QuoteResponseInput,
} from './customer.validation.js';


/**
 * ============================================================
 * CUSTOMER - CREATE JOB
 * ============================================================
 *
 * Customer creates a new repair request.
 *
 * IMPORTANT:
 *
 * The JOB uses the job-level summary status:
 *
 *     in_progress
 *
 * The individual JOB ITEM uses the detailed workflow status:
 *
 *     pending_cs_verification
 *
 * Therefore:
 *
 * JOB
 *     currentStatus = in_progress
 *
 * JOB ITEM
 *     currentStatus = pending_cs_verification
 *
 * The job itself remains in_progress throughout the workflow
 * until CS finally closes it.
 */
export const createCustomerJob = async (
  req: Request<{}, {}, CreateCustomerJobInput>,
  res: Response,
) => {
  try {
    const {
      deviceCategory,
      issueDescription,
      comment,
    } = req.body;

    const customerId =
      req.user?.userId;

    if (!customerId) {
      return res.status(401).json({
        error:
          'Authenticated customer is required',
      });
    }

    /* ---------------------------------------------------------
       Verify device category
       --------------------------------------------------------- */

    const [configuredCategory] =
      await db
        .select({
          deviceCategory:
            deviceServiceCharges.deviceCategory,
        })
        .from(deviceServiceCharges)
        .where(
          eq(
            deviceServiceCharges.deviceCategory,
            deviceCategory,
          ),
        )
        .limit(1);

    if (!configuredCategory) {
      return res.status(400).json({
        error:
          `Invalid device category: ${deviceCategory}`,
      });
    }

    /* ---------------------------------------------------------
       Generate IDs and job number
       --------------------------------------------------------- */

    const jobId =
      crypto.randomUUID();

    const jobItemId =
      crypto.randomUUID();

    const jobNumber =
      generateJobNumber();

    /* ---------------------------------------------------------
       Create job + job item in one transaction
       --------------------------------------------------------- */

    const result =
      await updateJobItemWithStatusTransition(
        jobItemId,
        null,
        'pending_cs_verification',

        async (tx) => {
          /* ---------------------------------------------------
             Create customer-level JOB
             ---------------------------------------------------

             IMPORTANT:
             pending_cs_verification does NOT belong here.

             Job starts as:
                 in_progress
          */

          const [job] =
            await tx
              .insert(jobs)
              .values({
                id: jobId,

                jobNumber,

                customerId,

                currentStatus:
                  'in_progress',
              })
              .returning();


          /* ---------------------------------------------------
             Create individual JOB ITEM
             ---------------------------------------------------

             The detailed workflow starts here:
                 pending_cs_verification
          */

          const [jobItem] =
            await tx
              .insert(jobItems)
              .values({
                id: jobItemId,

                jobId,

                deviceCategory,

                issueDescription,

                currentStatus:
                  'pending_cs_verification',
              })
              .returning();


          /* ---------------------------------------------------
             Customer comment is optional.
             ---------------------------------------------------

             This is a normal customer comment, not a mandatory
             workflow-action comment.
          */

          if (comment?.trim()) {
            await tx
              .insert(jobComments)
              .values({
                jobItemId,

                userId:
                  customerId,

                comment:
                  comment.trim(),
              });
          }


          return {
            job,
            jobItem,
          };
        },

        customerId,

        /*
         * The status-transition helper requires a note.
         *
         * Since this is customer-created initial workflow,
         * use a system-style workflow note rather than the
         * optional customer comment.
         */
        'Repair request created by customer.',
      );


    return res.status(201).json({
      message:
        'Repair request submitted successfully. It is awaiting CS verification.',

      job:
        result.job,

      jobItem:
        result.jobItem,
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
export const respondToQuote = async (
  req: Request<
    {},
    {},
    QuoteResponseInput
  >,
  res: Response,
) => {
  try {
    const {
      jobItemId,
      decision,
      comment,
    } = req.body;

    const userId =
      req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        error:
          'Authentication required',
      });
    }


    /* ---------------------------------------------------------
       Find the specific repair item
       --------------------------------------------------------- */

    const [jobItem] =
      await db
        .select({
          id: jobItems.id,

          jobId:
            jobItems.jobId,

          currentStatus:
            jobItems.currentStatus,

          isFinalQuoteApproved:
            jobItems.isFinalQuoteApproved,
        })
        .from(jobItems)
        .where(
          eq(
            jobItems.id,
            jobItemId,
          ),
        )
        .limit(1);

    if (!jobItem) {
      return res.status(404).json({
        error:
          'Job item not found',
      });
    }


    /* ---------------------------------------------------------
       Find parent job
       --------------------------------------------------------- */

    const [job] =
      await db
        .select({
          id: jobs.id,

          customerId:
            jobs.customerId,
        })
        .from(jobs)
        .where(
          eq(
            jobs.id,
            jobItem.jobId,
          ),
        )
        .limit(1);

    if (!job) {
      return res.status(404).json({
        error:
          'Job not found',
      });
    }


    /* ---------------------------------------------------------
       Verify customer ownership
       --------------------------------------------------------- */

    const roles =
      req.user?.roles ?? [];

    /*
     * Admin/employee users may be allowed through the route
     * depending on the application's authorization rules.
     *
     * A normal customer can only respond to their own job.
     */
    if (
      roles.includes('customer') &&
      job.customerId !== userId
    ) {
      return res.status(403).json({
        error:
          'You can only respond to quotes for your own jobs',
      });
    }


    /* ---------------------------------------------------------
       Validate current item status
       --------------------------------------------------------- */

    if (
      jobItem.currentStatus !==
      'awaiting_customer_approval'
    ) {
      return res.status(400).json({
        error:
          `Cannot respond to quote. Job item is currently in '${jobItem.currentStatus}' state.`,
      });
    }


    /* ---------------------------------------------------------
       Determine new item status
       --------------------------------------------------------- */

    const newStatus =
      decision === 'accept'
        ? 'repair_authorized'
        : 'repair_rejected';


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
      await updateJobItemWithStatusTransition(
        jobItem.id,

        jobItem.currentStatus,

        newStatus,

        async (tx) => {
          const [result] =
            await tx
              .update(jobItems)
              .set({
                currentStatus:
                  newStatus,

                isFinalQuoteApproved:
                  decision === 'accept',

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


          /* ---------------------------------------------------
             Customer comment is optional.
             --------------------------------------------------- */

          if (comment?.trim()) {
            await tx
              .insert(jobComments)
              .values({
                jobItemId:
                  jobItem.id,

                userId,

                comment:
                  comment.trim(),
              });
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
        decision === 'accept'
          ? 'Customer approved the final quote.'
          : 'Customer rejected the final quote.',
      );


    return res.status(200).json({
      message:
        decision === 'accept'
          ? 'Quote accepted successfully. Repair is now authorized.'
          : 'Quote rejected successfully.',

      jobItem:
        updatedJobItem,
    });
  } catch (error) {
    console.error(
      'Quote response error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while responding to quote',
    });
  }
};