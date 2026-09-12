import { Request, Response } from 'express';
import { desc, eq, inArray } from 'drizzle-orm';

import { db } from '../../config/database.js';

import { jobs, jobItems, jobComments, deviceServiceCharges, jobItemStatusHistory, jobStatusHistory, jobQuotes, jobItemQuotes, jobItemQuoteLines, } from '../../db/schema/index.js';

import { generateJobNumber } from '../../shared/utils/jobNumber.js';

import { updateJobItemWithStatusTransition, } from '../jobstatusandtransitions/item-status-history.js';

import { CreateCustomerJobInput, CreateCustomerJobItemSchema, QuoteResponseInput } from './customer.validation.js';
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
        currentStatus: jobs.currentStatus,
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
        error: `Cannot respond to quote. Quote is currently '${latestQuote.status}'.`,
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
      // Update quote status
      // -------------------------------------------------------

      await tx
        .update(jobQuotes)
        .set({
          status: accepted ? 'final' : 'rejected',
        })
        .where(eq(jobQuotes.id, latestQuote.id));

      // =======================================================
      // CUSTOMER REJECTED QUOTE
      // =======================================================

      if (!accepted) {
        for (const item of quotedItems) {
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
                      currentStatus:
                        'pending_final_quote',

                      isFinalQuoteApproved:
                        false,

                      onsiteRepairAuthorized:
                        false,

                      inlabRepairAuthorized:
                        false,

                      updatedAt:
                        new Date(),
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
        }

        await tx.insert(jobComments).values({
          jobId,
          jobItemId: null,
          userId,
          comment:
            comment?.trim() ||
            'Customer rejected the final job quote. Quote returned for negotiation.',
        });

        return;
      }

      // =======================================================
      // CUSTOMER ACCEPTED QUOTE
      // =======================================================


      let hasLabItem = false;
      let hasOnsiteItem = false;

      for (const item of quotedItems) {
        const isCustomerSite =
          item.repairLocation === 'customer_site';

        const isLab =
          item.repairLocation === 'inlab';

        if (!isCustomerSite && !isLab) {
          throw new Error(
            `Unsupported repair location '${item.repairLocation}' for job item ${item.jobItemId}`,
          );
        }

        if (isCustomerSite) {
          hasOnsiteItem = true;
        }

        if (isLab) {
          hasLabItem = true;
        }

        const newStatus = isCustomerSite
          ? 'transport_visit_in_progress'
          : 'assigned_to_repair_person';

        const itemComment = isCustomerSite
          ? 'Customer approved the final quote. Onsite repair can proceed.'
          : 'Customer approved the final quote. Lab repair can proceed.';

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
                      isCustomerSite,

                    inlabRepairAuthorized:
                      isLab,

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

      // =======================================================
      // JOB STATUS
      // =======================================================

      /*
       * If ANY item is going to the lab:
       *
       * pending_final_quote
       *          ↓
       * repair_in_progress
       *
       * Otherwise all items are onsite:
       *
       * pending_final_quote
       *          ↓
       * repair_started
       */

      if (hasLabItem) {
        await transitionJob({
          jobId,
          previousStatus:
            job.currentStatus,
          newStatus:
            'repair_in_progress',
          changedBy: userId,
          note:
            comment?.trim() ||
            'Customer approved the final quote. Repair can now proceed.',
          updateJob: async (transaction) => {
            const [updatedJob] =
              await transaction
                .update(jobs)
                .set({
                  currentStatus:
                    'repair_in_progress',
                  updatedAt: new Date(),
                })
                .where(eq(jobs.id, jobId))
                .returning();

            return updatedJob;
          },
          existingTx: tx,
        });
      } else if (hasOnsiteItem) {
        await transitionJob({
          jobId,
          previousStatus:
            job.currentStatus,
          newStatus:
            'repair_started',
          changedBy: userId,
          note:
            comment?.trim() ||
            'Customer approved the final quote. Onsite repair can now begin.',
          updateJob: async (transaction) => {
            const [updatedJob] =
              await transaction
                .update(jobs)
                .set({
                  currentStatus:
                    'repair_started',
                  updatedAt: new Date(),
                })
                .where(eq(jobs.id, jobId))
                .returning();

            return updatedJob;
          },
          existingTx: tx,
        });
      }

      // -------------------------------------------------------
      // Job-level customer comment
      // -------------------------------------------------------

      await tx.insert(jobComments).values({
        jobId,
        jobItemId: null,
        userId,
        comment:
          comment?.trim() ||
          'Customer approved the final job quote.',
      });
    });

    // ---------------------------------------------------------
    // Response
    // ---------------------------------------------------------

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



export const getCustomerPendingQuotes = async (
  req: Request,
  res: Response,
) => {
  try {
    const customerId = req.user?.userId;

    if (!customerId) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    // ---------------------------------------------------------
    // Find customer's jobs
    // ---------------------------------------------------------

    const customerJobs = await db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        currentStatus: jobs.currentStatus,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .where(
        eq(
          jobs.customerId,
          customerId,
        ),
      );

    if (customerJobs.length === 0) {
      return res.status(200).json({
        status: 'success',
        count: 0,
        quotes: [],
      });
    }

    const jobIds = customerJobs.map(
      (job) => job.id,
    );

    // ---------------------------------------------------------
    // Get all quotes for customer's jobs
    // ---------------------------------------------------------

    const allQuotes = await db
      .select()
      .from(jobQuotes)
      .where(
        inArray(
          jobQuotes.jobId,
          jobIds,
        ),
      )
      .orderBy(
        desc(jobQuotes.version),
      );

    // ---------------------------------------------------------
    // Keep only latest quote per job
    // ---------------------------------------------------------

    const latestQuoteByJobId =
      new Map<
        string,
        (typeof allQuotes)[number]
      >();

    for (const quote of allQuotes) {
      if (
        !latestQuoteByJobId.has(
          quote.jobId,
        )
      ) {
        latestQuoteByJobId.set(
          quote.jobId,
          quote,
        );
      }
    }

    // ---------------------------------------------------------
    // Customer only needs quotes waiting for approval
    // ---------------------------------------------------------

    const pendingQuotes = [
      ...latestQuoteByJobId.values(),
    ].filter(
      (quote) =>
        quote.status === 'pending',
    );

    if (pendingQuotes.length === 0) {
      return res.status(200).json({
        status: 'success',
        count: 0,
        quotes: [],
      });
    }

    const pendingQuoteIds =
      pendingQuotes.map(
        (quote) => quote.id,
      );

    // ---------------------------------------------------------
    // Get quote items
    // ---------------------------------------------------------

    const quoteItems =
      await db
        .select({
          quoteItem: jobItemQuotes,
          jobItem: jobItems,
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
          inArray(
            jobItemQuotes.jobQuoteId,
            pendingQuoteIds,
          ),
        );

    // ---------------------------------------------------------
    // Get quote item IDs
    // ---------------------------------------------------------

    const quoteItemIds =
      quoteItems.map(
        (row) => row.quoteItem.id,
      );

    // ---------------------------------------------------------
    // Get components
    // ---------------------------------------------------------

    const quoteLines =
      quoteItemIds.length > 0
        ? await db
          .select()
          .from(
            jobItemQuoteLines,
          )
          .where(
            inArray(
              jobItemQuoteLines.quoteId,
              quoteItemIds,
            ),
          )
          .orderBy(
            jobItemQuoteLines.sortOrder,
          )
        : [];

    // ---------------------------------------------------------
    // Group components by quote item
    // ---------------------------------------------------------

    const linesByQuoteItemId =
      new Map<
        string,
        typeof quoteLines
      >();

    for (const line of quoteLines) {
      const existing =
        linesByQuoteItemId.get(
          line.quoteId,
        );

      if (existing) {
        existing.push(line);
      } else {
        linesByQuoteItemId.set(
          line.quoteId,
          [line],
        );
      }
    }

    // ---------------------------------------------------------
    // Job lookup
    // ---------------------------------------------------------

    const jobById = new Map(
      customerJobs.map(
        (job) => [
          job.id,
          job,
        ],
      ),
    );

    // ---------------------------------------------------------
    // Build response
    // ---------------------------------------------------------

    const result = pendingQuotes.map(
      (quote) => {
        const job =
          jobById.get(
            quote.jobId,
          );

        const items =
          quoteItems
            .filter(
              (row) =>
                row.quoteItem
                  .jobQuoteId ===
                quote.id,
            )
            .map(
              ({
                quoteItem,
                jobItem,
              }) => {
                const lines =
                  linesByQuoteItemId.get(
                    quoteItem.id,
                  ) ?? [];

                return {
                  jobItemId:
                    jobItem.id,

                  deviceCategory:
                    jobItem.deviceCategory,

                  deviceSerialNumber:
                    jobItem.deviceSerialNumber,

                  issueDescription:
                    jobItem.issueDescription,

                  issueCategory:
                    jobItem.issueCategory,

                  repairLocation:
                    jobItem.repairLocation,

                  currentStatus:
                    jobItem.currentStatus,

                  components:
                    lines.map(
                      (line) => ({
                        name:
                          line.name,

                        quantity:
                          line.quantity,

                        unitPrice:
                          line.unitPrice,

                        lineTotal:
                          line.lineTotal,
                      }),
                    ),

                  componentsCost:
                    quoteItem.componentsCost,

                  serviceCharge:
                    quoteItem.serviceCharge,

                  totalAmount:
                    quoteItem.totalAmount,
                };
              },
            );

        return {
          job,
          quote: {
            id: quote.id,
            version:
              quote.version,
            status:
              quote.status,
            subtotal:
              quote.subtotal,
            serviceCharge:
              quote.serviceCharge,
            discount:
              quote.discount,
            tax:
              quote.tax,
            totalAmount:
              quote.totalAmount,
            createdByUserId:
              quote.createdByUserId,
            createdAt:
              quote.createdAt,
          },
          items,
        };
      },
    );

    return res.status(200).json({
      status: 'success',
      count: result.length,
      quotes: result,
    });
  } catch (error) {
    console.error(
      'Get customer pending quotes error:',
      error,
    );

    return res.status(500).json({
      status: 'error',
      message:
        'Failed to fetch pending quotes',
    });
  }
};