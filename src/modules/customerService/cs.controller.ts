import { Request, Response } from 'express';

import {
  asc,
  desc,
  eq,
  inArray,
} from 'drizzle-orm';

import { db } from '../../config/database.js';

import {
  jobs,
  jobItems,
  jobComments,
  jobStatusHistory,
  jobClosures,
  jobItemQuotes,
  deviceServiceCharges,
} from '../../db/schema/index.js';

import {
  CSApproveJobItemInput,
  CSRejectJobItemInput,
  GenerateFinalQuoteInput,
  CloseJobInput,
  ConfirmOnsiteRepairInput,
} from './cs.validation.js';

import {
  updateJobItemWithStatusTransition,
} from '../jobs/item-status-history.js';


/**
 * ============================================================
 * CS - APPROVE JOB ITEM
 * ============================================================
 *
 * Workflow:
 *
 * pending_cs_verification
 *          ↓
 * approved_for_transport
 *
 * The job itself remains:
 *
 * in_progress
 *
 * The workflow status belongs to the job item.
 */
export const approveJobItemByCS = async (
  req: Request<{}, {}, CSApproveJobItemInput>,
  res: Response,
) => {
  try {
    const {
      jobItemId,
      estimatedComponentsCost,
      comment,
    } = req.body;

    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({
        error: 'Authenticated CS user is required',
      });
    }

    const [jobItem] = await db
      .select()
      .from(jobItems)
      .where(eq(jobItems.id, jobItemId))
      .limit(1);

    if (!jobItem) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    if (
      jobItem.currentStatus !==
      'pending_cs_verification'
    ) {
      return res.status(400).json({
        error:
          `Job item cannot be approved because its current status is '${jobItem.currentStatus}'`,
      });
    }

    const updatedJobItem =
      await updateJobItemWithStatusTransition(
        jobItem.id,
        jobItem.currentStatus,
        'approved_for_transport',

        async (tx) => {
          const [updated] = await tx
            .update(jobItems)
            .set({
              currentStatus:
                'approved_for_transport',

              ...(estimatedComponentsCost !== undefined
                ? {
                    estimatedComponentsCost:
                      estimatedComponentsCost.toString(),
                  }
                : {}),

              updatedAt: new Date(),
            })
            .where(eq(jobItems.id, jobItem.id))
            .returning();

          return updated;
        },

        csUserId,
        comment.trim(),
      );

    return res.status(200).json({
      message:
        'Job item verified successfully and approved for transport.',
      jobItem: updatedJobItem,
    });
  } catch (error) {
    console.error(
      'CS Job Item Approval Error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error during job item approval',
    });
  }
};

/**
 * ============================================================
 * CS - REJECT JOB ITEM
 * ============================================================
 *
 * Workflow:
 *
 * pending_cs_verification
 *          ↓
 * repair_rejected
 */
export const rejectJobItemByCS = async (
  req: Request<{}, {}, CSRejectJobItemInput>,
  res: Response,
) => {
  try {
    const {
      jobItemId,
      comment,
    } = req.body;

    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({
        error: 'Authenticated CS user is required',
      });
    }

    const [jobItem] = await db
      .select()
      .from(jobItems)
      .where(eq(jobItems.id, jobItemId))
      .limit(1);

    if (!jobItem) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    if (
      jobItem.currentStatus !==
      'pending_cs_verification'
    ) {
      return res.status(400).json({
        error:
          `Job item cannot be rejected from '${jobItem.currentStatus}'`,
      });
    }

    const updatedJobItem =
      await updateJobItemWithStatusTransition(
        jobItem.id,
        jobItem.currentStatus,
        'repair_rejected',

        async (tx) => {
          const [updated] = await tx
            .update(jobItems)
            .set({
              currentStatus: 'repair_rejected',
              updatedAt: new Date(),
            })
            .where(eq(jobItems.id, jobItem.id))
            .returning();

          return updated;
        },

        csUserId,
        comment.trim(),
      );

    return res.status(200).json({
      message:
        'Job item rejected successfully.',
      jobItem: updatedJobItem,
    });
  } catch (error) {
    console.error(
      'CS Job Item Rejection Error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error during job item rejection',
    });
  }
};

/**
 * ============================================================
 * CS - GENERATE FINAL QUOTE
 * ============================================================
 *
 * This supports both quote flows:
 *
 * LAB:
 *
 * diagnosis_in_progress
 *          ↓
 * pending_final_quote
 *          ↓
 * awaiting_customer_approval
 *
 *
 * ONSITE:
 *
 * transport_inspection
 *          ↓
 * pending_final_quote_onsite
 *          ↓
 * awaiting_customer_approval
 *
 *
 * CS is responsible for generating the final quote.
 *
 * The job itself remains:
 *
 * in_progress
 */
export const generateFinalQuote = async (
  req: Request<{}, {}, GenerateFinalQuoteInput>,
  res: Response,
) => {
  try {
    const {
      jobItemId,
      finalComponentsCost,
      comment,
    } = req.body;

    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({
        error: 'Authenticated CS user is required',
      });
    }

    const [jobItem] = await db
      .select()
      .from(jobItems)
      .where(eq(jobItems.id, jobItemId))
      .limit(1);

    if (!jobItem) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    const allowedQuoteStatuses = [
      'pending_final_quote',
      'pending_final_quote_onsite',
    ] as const;

    if (
      !allowedQuoteStatuses.includes(
        jobItem.currentStatus as
          (typeof allowedQuoteStatuses)[number],
      )
    ) {
      return res.status(400).json({
        error:
          `Cannot generate quote from status '${jobItem.currentStatus}'`,
      });
    }

    /**
     * Get the service charge configured for
     * this device category.
     *
     * This is important because the service charge
     * is not exposed to the customer initially.
     */
    const [serviceCharge] = await db
      .select()
      .from(deviceServiceCharges)
      .where(
        eq(
          deviceServiceCharges.deviceCategory,
          jobItem.deviceCategory,
        ),
      )
      .limit(1);

    if (!serviceCharge) {
      return res.status(400).json({
        error:
          `No service charge configured for category: ${jobItem.deviceCategory}`,
      });
    }

    const componentsCost =
      finalComponentsCost;

    const serviceChargeAmount =
      Number(serviceCharge.chargeAmount);

    const totalAmount =
      componentsCost +
      serviceChargeAmount;

    /**
     * Find the latest quote version so that
     * every new quote gets the next version.
     */
    const [latestQuote] = await db
      .select()
      .from(jobItemQuotes)
      .where(
        eq(
          jobItemQuotes.jobItemId,
          jobItem.id,
        ),
      )
      .orderBy(
        desc(jobItemQuotes.version),
      )
      .limit(1);

    const nextVersion =
      (latestQuote?.version ?? 0) + 1;

    const updatedJobItem =
      await updateJobItemWithStatusTransition(
        jobItem.id,
        jobItem.currentStatus,
        'awaiting_customer_approval',

        async (tx) => {
          const [updated] = await tx
            .update(jobItems)
            .set({
              finalComponentsCost:
                componentsCost.toString(),

              serviceChargeApplied:
                serviceCharge.chargeAmount,

              isFinalQuoteApproved: false,

              currentStatus:
                'awaiting_customer_approval',

              updatedAt: new Date(),
            })
            .where(eq(jobItems.id, jobItem.id))
            .returning();

          await tx.insert(jobItemQuotes).values({
            jobItemId: jobItem.id,

            version: nextVersion,

            componentsCost:
              componentsCost.toString(),

            serviceCharge:
              serviceCharge.chargeAmount,

            totalAmount:
              totalAmount.toString(),

            createdByUserId:
              csUserId,

            customerApproved: null,

            status:
              'pending_customer_approval',
          });

          return updated;
        },

        csUserId,
        comment.trim(),
      );

    return res.status(200).json({
      message:
        'Final quote generated successfully. Awaiting customer approval.',

      jobItem: updatedJobItem,

      quote: {
        version: nextVersion,
        componentsCost,
        serviceCharge:
          serviceChargeAmount,
        totalAmount,
      },
    });
  } catch (error) {
    console.error(
      'Final Quote Error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while generating quote',
    });
  }
};

/**
 * ============================================================
 * CS - GET PENDING FINAL QUOTES
 * ============================================================
 *
 * Both onsite and lab items can require a final quote.
 */
export const getPendingFinalQuotes = async (
  req: Request,
  res: Response,
) => {
  try {
    const pendingQuotes = await db
      .select({
        job: jobs,
        jobItem: jobItems,
      })
      .from(jobItems)
      .innerJoin(
        jobs,
        eq(jobItems.jobId, jobs.id),
      )
      .where(
        inArray(
          jobItems.currentStatus,
          [
            'pending_final_quote',
            'pending_final_quote_onsite',
          ],
        ),
      )
      .orderBy(
        desc(jobItems.updatedAt),
      );

    return res.status(200).json({
      count: pendingQuotes.length,
      jobs: pendingQuotes,
    });
  } catch (error) {
    console.error(
      'Fetch pending quotes error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while fetching pending quotes',
    });
  }
};

/**
 * ============================================================
 * CS - GET JOBS WAITING FOR CS VERIFICATION
 * ============================================================
 *
 * The queue is based on item status.
 *
 * Job status is NOT used here.
 */
export const getJobsWaitingForCSApproval = async (
  req: Request,
  res: Response,
) => {
  try {
    const data = await db
      .select({
        job: jobs,
        jobItem: jobItems,
      })
      .from(jobItems)
      .innerJoin(
        jobs,
        eq(jobItems.jobId, jobs.id),
      )
      .where(
        eq(
          jobItems.currentStatus,
          'pending_cs_verification',
        ),
      )
      .orderBy(
        desc(jobItems.updatedAt),
      );

    return res.status(200).json({
      count: data.length,
      jobs: data,
    });
  } catch (error) {
    console.error(
      'Error fetching jobs waiting for CS approval:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while fetching jobs',
    });
  }
};

/**
 * ============================================================
 * CS - GET ITEMS WAITING FOR ONSITE CONFIRMATION
 * ============================================================
 */
export const getPendingOnsiteConfirmations = async (
  req: Request,
  res: Response,
) => {
  try {
    const items = await db
      .select({
        job: jobs,
        jobItem: jobItems,
      })
      .from(jobItems)
      .innerJoin(
        jobs,
        eq(jobItems.jobId, jobs.id),
      )
      .where(
        eq(
          jobItems.currentStatus,
          'pending_cs_confirmation',
        ),
      )
      .orderBy(
        asc(jobItems.updatedAt),
      );

    return res.status(200).json({
      count: items.length,
      items,
    });
  } catch (error) {
    console.error(
      'Get pending onsite confirmations error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};

/**
 * ============================================================
 * CS - CONFIRM ONSITE REPAIR
 * ============================================================
 *
 * Workflow:
 *
 * repair_in_progress
 *          ↓
 * pending_cs_confirmation
 *          ↓
 * CS confirms with customer
 *          ↓
 * ready_for_delivery
 *
 * Only customer-site repairs can use this endpoint.
 */
export const confirmOnsiteRepair = async (
  req: Request<
    {},
    {},
    ConfirmOnsiteRepairInput
  >,
  res: Response,
) => {
  try {
    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({
        error: 'Authentication required',
      });
    }

    const {
      jobItemId,
      customerConfirmed,
      comment,
    } = req.body;

    if (!customerConfirmed) {
      return res.status(400).json({
        error:
          'Customer confirmation is required.',
      });
    }

    const [item] = await db
      .select()
      .from(jobItems)
      .where(eq(jobItems.id, jobItemId))
      .limit(1);

    if (!item) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    if (
      item.currentStatus !==
      'pending_cs_confirmation'
    ) {
      return res.status(400).json({
        error:
          `Cannot confirm onsite repair from status '${item.currentStatus}'.`,
      });
    }

    if (
      item.repairLocation !==
      'customer_site'
    ) {
      return res.status(400).json({
        error:
          'This item is not an onsite repair item.',
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'ready_for_delivery',

        async (tx) => {
          const [result] = await tx
            .update(jobItems)
            .set({
              currentStatus:
                'ready_for_delivery',

              isFinalQuoteApproved: true,

              updatedAt: new Date(),
            })
            .where(
              eq(
                jobItems.id,
                jobItemId,
              ),
            )
            .returning();

          return result;
        },

        csUserId,
        comment.trim(),
      );

    return res.status(200).json({
      message:
        'Onsite repair has been confirmed with the customer.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Confirm onsite repair error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};

/**
 * ============================================================
 * CS - GET JOBS WAITING FOR CLOSURE
 * ============================================================
 *
 * A job can be closed when ALL of its items are:
 *
 * - delivered
 * OR
 * - repair_rejected
 *
 * The job itself must still be:
 *
 * in_progress
 *
 * This query intentionally works from item statuses,
 * not from the job summary status.
 */
export const getJobsWaitingToBeClosed = async (
  req: Request,
  res: Response,
) => {
  try {
    const data = await db
      .select({
        job: jobs,
        jobItem: jobItems,
      })
      .from(jobItems)
      .innerJoin(
        jobs,
        eq(jobItems.jobId, jobs.id),
      )
      .where(
        inArray(
          jobItems.currentStatus,
          [
            'delivered',
            'repair_rejected',
          ],
        ),
      )
      .orderBy(
        desc(jobItems.updatedAt),
      );

    /**
     * Group items by job.
     *
     * We cannot simply return every job having one
     * delivered item because a job may contain multiple
     * items and some of them may still be in progress.
     */
    const groupedJobs = new Map<
      string,
      {
        job: typeof data[number]['job'];
        items: typeof data[number]['jobItem'][];
      }
    >();

    for (const row of data) {
      const jobId = row.job.id;

      const existing =
        groupedJobs.get(jobId);

      if (existing) {
        existing.items.push(
          row.jobItem,
        );
      } else {
        groupedJobs.set(jobId, {
          job: row.job,
          items: [row.jobItem],
        });
      }
    }

    /**
     * We need to make sure EVERY item belonging to the
     * job is final, not only the items returned above.
     */
    const result = [];

    for (const [jobId, group] of groupedJobs) {
      const allItems = await db
        .select({
          id: jobItems.id,
          currentStatus:
            jobItems.currentStatus,
        })
        .from(jobItems)
        .where(
          eq(
            jobItems.jobId,
            jobId,
          ),
        );

      if (allItems.length === 0) {
        continue;
      }

      const allItemsFinal =
        allItems.every(
          (item) =>
            item.currentStatus ===
              'delivered' ||
            item.currentStatus ===
              'repair_rejected',
        );

      if (allItemsFinal) {
        result.push({
          job: group.job,
          items: allItems,
        });
      }
    }

    return res.status(200).json({
      count: result.length,
      jobs: result,
    });
  } catch (error) {
    console.error(
      'Job Fetch error:',
      error,
    );

    return res.status(500).json({
      error:
        'Cannot fetch jobs ready for closure',
    });
  }
};

/**
 * ============================================================
 * CS - CLOSE JOB
 * ============================================================
 *
 * A job is closed ONLY here.
 *
 * Normal workflow:
 *
 * jobs.currentStatus
 *
 * in_progress
 *      ↓
 * done
 *
 * All detailed workflow information lives on job_items.
 */
export const closeJobRequest = async (
  req: Request<{}, {}, CloseJobInput>,
  res: Response,
) => {
  try {
    const {
      jobId,
      customerConfirmed,
      paymentConfirmed,
      closingRemarks,
    } = req.body;

    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({
        error: 'Authenticated CS user is required',
      });
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    /**
     * Job-level status should only be changed from
     * in_progress to done.
     */
    if (
      job.currentStatus !==
      'in_progress'
    ) {
      return res.status(400).json({
        error:
          `Job cannot be closed because its current status is '${job.currentStatus}'.`,
      });
    }

    const items = await db
      .select({
        id: jobItems.id,
        currentStatus:
          jobItems.currentStatus,
      })
      .from(jobItems)
      .where(
        eq(
          jobItems.jobId,
          jobId,
        ),
      );

    if (items.length === 0) {
      return res.status(400).json({
        error:
          'Cannot close a job that has no items',
      });
    }

    /**
     * Every item must reach a terminal business outcome.
     */
    const allItemsFinal =
      items.every(
        (item) =>
          item.currentStatus ===
            'delivered' ||
          item.currentStatus ===
            'repair_rejected',
      );

    if (!allItemsFinal) {
      return res.status(400).json({
        error:
          'Cannot close job. All job items must be delivered or repair rejected.',
      });
    }

    if (!customerConfirmed) {
      return res.status(400).json({
        error:
          'Customer confirmation is required before closing the job.',
      });
    }

    if (!paymentConfirmed) {
      return res.status(400).json({
        error:
          'Payment confirmation is required before closing the job.',
      });
    }

    const updatedJob =
      await db.transaction(
        async (tx) => {
          /**
           * Re-check the status inside the transaction
           * before performing the final update.
           */
          const [currentJob] =
            await tx
              .select()
              .from(jobs)
              .where(
                eq(
                  jobs.id,
                  jobId,
                ),
              )
              .limit(1);

          if (!currentJob) {
            throw new Error(
              'Job not found during closure transaction',
            );
          }

          if (
            currentJob.currentStatus !==
            'in_progress'
          ) {
            throw new Error(
              `Job cannot be closed from status '${currentJob.currentStatus}'`,
            );
          }

          /**
           * Validate the configured job-level
           * transition.
           */

          const [closedJob] =
            await tx
              .update(jobs)
              .set({
                currentStatus: 'done',
                updatedAt:
                  new Date(),
              })
              .where(
                eq(
                  jobs.id,
                  jobId,
                ),
              )
              .returning();

          /**
           * Record the actual job-level status change.
           */
          await tx
            .insert(jobStatusHistory)
            .values({
              jobId,

              previousStatus:
                'in_progress',

              newStatus:
                'done',

              changedBy:
                csUserId,

              note:
                closingRemarks.trim(),
            });

          /**
           * Store the closure record.
           */
          await tx
            .insert(jobClosures)
            .values({
              jobId,

              closedByUserId:
                csUserId,

              closureReason:
                'All job items reached final status.',

              customerConfirmed: true,

              paymentConfirmed: true,

              notes:
                closingRemarks.trim(),
            });

          /**
           * Closure comment belongs to the JOB,
           * not to every item.
           */
          await tx
            .insert(jobComments)
            .values({
              jobId,

              userId:
                csUserId,

              comment:
                closingRemarks.trim(),
            });

          return closedJob;
        },
      );

    return res.status(200).json({
      message:
        'Job successfully closed.',
      job: updatedJob,
    });
  } catch (error) {
    console.error(
      'Job closure error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while closing job',
    });
  }
};
