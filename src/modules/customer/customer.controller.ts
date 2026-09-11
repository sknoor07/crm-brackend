import { Request, Response } from 'express';
import { desc, eq } from 'drizzle-orm';

import { db } from '../../config/database.js';

import {jobs,jobItems,jobComments,deviceServiceCharges, jobItemStatusHistory, jobStatusHistory, jobQuotes, jobItemQuotes,} from '../../db/schema/index.js';

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

export const respondToQuote = async (
  req: Request<{}, {}, QuoteResponseInput>,
  res: Response,
) => {
  try {
    const {
      jobId,
      decision,
      comment,
    } = req.body;

    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const roles = req.user?.roles ?? [];

    // ---------------------------------------------------------
    // Find job
    // ---------------------------------------------------------

    const [job] = await db
      .select({
        id: jobs.id,
        customerId: jobs.customerId,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    // ---------------------------------------------------------
    // Verify customer ownership
    // ---------------------------------------------------------

    if (
      roles.includes('customer') &&
      job.customerId !== userId
    ) {
      return res.status(403).json({
        error:
          'You can only respond to quotes for your own jobs',
      });
    }

    // ---------------------------------------------------------
    // Find latest quote for the job
    // ---------------------------------------------------------

    const [latestQuote] = await db
      .select()
      .from(jobQuotes)
      .where(eq(jobQuotes.jobId, jobId))
      .orderBy(desc(jobQuotes.version))
      .limit(1);

    if (!latestQuote) {
      return res.status(404).json({
        error: 'Quote not found for this job',
      });
    }

    // ---------------------------------------------------------
    // Quote must be pending
    // ---------------------------------------------------------

    if (latestQuote.status !== 'pending') {
      return res.status(400).json({
        error:
          `Cannot respond to quote. Quote is currently '${latestQuote.status}'.`,
      });
    }

    // ---------------------------------------------------------
    // Get all items belonging to this quote
    // ---------------------------------------------------------

    const quotedItems = await db
      .select({
        jobItemId: jobItemQuotes.jobItemId,
        jobItemQuoteId: jobItemQuotes.id,
        repairLocation: jobItems.repairLocation,
        currentStatus: jobItems.currentStatus,
      })
      .from(jobItemQuotes)
      .innerJoin(
        jobItems,
        eq(
          jobItems.id,
          jobItemQuotes.jobItemId,
        ),
      )
      .where(
        eq(
          jobItemQuotes.jobQuoteId,
          latestQuote.id,
        ),
      );

    if (quotedItems.length === 0) {
      return res.status(400).json({
        error:
          'The quote does not contain any job items',
      });
    }

    // ---------------------------------------------------------
    // Customer decision
    // ---------------------------------------------------------

    const accepted = decision === 'accept';

    const updatedItems: (typeof jobItems.$inferSelect)[] = [];

    await db.transaction(async (tx) => {
      // -------------------------------------------------------
      // Update job quote status
      // -------------------------------------------------------

      await tx
        .update(jobQuotes)
        .set({
          status: accepted
            ? 'final'
            : 'rejected',
        })
        .where(
          eq(
            jobQuotes.id,
            latestQuote.id,
          ),
        );

      // -------------------------------------------------------
      // Approve / reject every item in this quote
      // -------------------------------------------------------

      for (const item of quotedItems) {
        if (!accepted) {
          const updatedItem =
            await updateJobItemWithStatusTransition(
              item.jobItemId,
              item.currentStatus,
              'pending_final_quote',
              async (transaction) => {
                const [result] =
                  await transaction
                    .update(jobItems)
                    .set({
                      // IMPORTANT:
                      // The helper only validates/logs the
                      // transition. We must update the actual
                      // current status here.
                      currentStatus:
                        'pending_final_quote',

                      isFinalQuoteApproved: false,

                      onsiteRepairAuthorized: false,

                      updatedAt: new Date(),
                    })
                    .where(
                      eq(
                        jobItems.id,
                        item.jobItemId,
                      ),
                    )
                    .returning();

                return result;
              },
              userId,
              comment?.trim() ||
                'Customer rejected the final quote. Quote returned for negotiation.',
              tx,
            );

          updatedItems.push(updatedItem);

          continue;
        }

        // -----------------------------------------------------
        // Customer accepted the entire job quote
        // -----------------------------------------------------

        const newStatus =
          item.repairLocation === 'customer_site'
            ? 'assigned_to_repair_person'
            : 'transport_visit_in_progress';

        const itemComment =
          item.repairLocation === 'customer_site'
            ? 'Customer approved the final quote. Onsite repair is authorized.'
            : 'Customer approved the final quote. Item can proceed to lab transport.';

        const updatedItem =
          await updateJobItemWithStatusTransition(
            item.jobItemId,
            item.currentStatus,
            newStatus,
            async (transaction) => {
              const [result] =
                await transaction
                  .update(jobItems)
                  .set({
                    currentStatus: newStatus,

                    isFinalQuoteApproved: true,

                    onsiteRepairAuthorized:
                      item.repairLocation ===
                      'customer_site',

                    updatedAt: new Date(),
                  })
                  .where(
                    eq(
                      jobItems.id,
                      item.jobItemId,
                    ),
                  )
                  .returning();

              return result;
            },
            userId,
            comment?.trim() || itemComment,
            tx,
          );

        updatedItems.push(updatedItem);
      }

      // -------------------------------------------------------
      // Job-level customer comment
      // -------------------------------------------------------

      await tx.insert(jobComments).values({
        jobId,
        userId,
        comment:
          comment?.trim() ||
          (
            accepted
              ? 'Customer approved the final job quote.'
              : 'Customer rejected the final job quote.'
          ),
      });
    });

    return res.status(200).json({
      message: accepted
        ? 'Quote approved successfully. The job items can now proceed.'
        : 'Quote rejected successfully.',
      quote: {
        id: latestQuote.id,
        version: latestQuote.version,
        status: accepted
          ? 'final'
          : 'rejected',
      },
      jobItems: updatedItems,
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

