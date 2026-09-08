import { Request, Response } from 'express';

import { and, asc, desc, eq, exists, inArray, notExists, sql } from 'drizzle-orm';

import { db } from '../../config/database.js';

import { jobs, jobItems, jobComments, jobStatusHistory, jobClosures, jobItemQuotes, deviceServiceCharges, jobItemQuoteLines, JobItemStatus, jobItemStatusHistory, JobSummaryStatus, users, customerProfiles, } from '../../db/schema/index.js';

import {
  CSRejectJobItemInput, GenerateFinalQuoteInput, CloseJobInput, ConfirmOnsiteRepairInput, CSApproveJobAndJobItemInput,
} from './cs.validation.js';

import { updateJobItemWithStatusTransition } from '../jobs/item-status-history.js';
import { buildQuoteLineValues, insertJobItemQuoteWithLines, moneyString, resolveQuoteComponents } from '../jobs/quote-components.js';
import { processCSJobApproval } from './service/approveJobsByCS.js';


// Get All Jobs which are applied by customer and pending for approval at cs
export const getJobsWaitingForCSApproval = async (req: Request, res: Response,) => {
  try {
    const data = await db
      .select({ job: jobs, jobItem: jobItems, })
      .from(jobItems)
      .innerJoin(jobs, eq(jobItems.jobId, jobs.id),)
      .where(eq(jobItems.currentStatus, 'pending_cs_verification',),)
      .orderBy(desc(jobItems.updatedAt),);

    // Group job items by job ID
    const groupedJobs = new Map<string, { job: typeof jobs.$inferSelect; jobItems: typeof jobItems.$inferSelect[]; }>();

    for (const row of data) {
      const jobId = row.job.id;

      if (!groupedJobs.has(jobId)) {
        groupedJobs.set(jobId, { job: row.job, jobItems: [], });
      }

      groupedJobs.get(jobId)!.jobItems.push(row.jobItem);
    }

    const result = Array.from(groupedJobs.values(),);

    return res.status(200).json({ count: result.length, jobs: result, });
  } catch (error) {
    console.error('Error fetching jobs waiting for CS approval:', error,);
    return res.status(500).json({ error: 'Internal server error while fetching jobs', });
  }
};

interface CustomerParams {
  id: string;
}

export const getCustomerDetails = async (
  req: Request<CustomerParams>,
  res: Response
) => {
  try {
    const customerId = req.params.id;

    if (!customerId) {
      return res.status(400).json({
        message: "Invalid customer ID",
      });
    }

    const customerDetails = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, customerId)).limit(1);

    return res.status(200).json(customerDetails);
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Failed to get customer details",
    });
  }
};

/**
 Job Item Approve for Transport team Manager so he can arrange for Pickup only by Transport Team Members
 */
export const approveJobByCS = async (req: Request<{}, {}, CSApproveJobAndJobItemInput>, res: Response,) => {
  try {
    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({ error: 'Authenticated CS user is required', });
    }

    const result = await processCSJobApproval(req.body, csUserId);

    return res.status(200).json({
      message: 'CS job verification processed successfully.',
      job: result.job,
      jobItems: result.jobItems,
    });
  } catch (error) {
    console.error('CS job approval error:', error,);

    return res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to process CS job verification', });
  }
};

/**
customer  rejects a repair for a item
 */
export const rejectJobItemByCS = async (req: Request<{}, {}, CSRejectJobItemInput>, res: Response) => {
  try {
    const { jobItemId, comment } = req.body;

    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({ error: 'Authenticated CS user is required' });
    }

    const [jobItem] = await db.select()
      .from(jobItems).where(eq(jobItems.id, jobItemId)).limit(1);

    if (!jobItem) {
      return res.status(404).json({ error: 'Job item not found' });
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

    const updatedJobItem = await updateJobItemWithStatusTransition(jobItem.id, jobItem.currentStatus, 'repair_rejected',
      async (tx) => { const [updated] = await tx.update(jobItems).set({ currentStatus: 'repair_rejected', updatedAt: new Date() }).where(eq(jobItems.id, jobItem.id)).returning(); return updated; }, csUserId, comment.trim());

    return res.status(200).json({ message: 'Job item rejected successfully.', jobItem: updatedJobItem });
  } catch (error) {
    console.error('CS Job Item Rejection Error:', error);
    return res.status(500).json({ error: 'Internal server error during job item rejection' });
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
export const generateFinalQuote = async (req: Request<{}, {}, GenerateFinalQuoteInput>, res: Response) => {
  try {
    const { jobItemId, components, comment } = req.body;

    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({ error: 'Authenticated CS user is required' });
    }

    const [jobItem] = await db.select().from(jobItems).where(eq(jobItems.id, jobItemId)).limit(1);

    if (!jobItem) {
      return res.status(404).json({ error: 'Job item not found' });
    }

    const allowedQuoteStatuses = ['pending_final_quote', 'pending_final_quote_onsite'] as const;

    if (!allowedQuoteStatuses.includes(jobItem.currentStatus as (typeof allowedQuoteStatuses)[number])) {
      return res.status(400).json({ error: `Cannot generate quote from status '${jobItem.currentStatus}'` });
    }

    /**
     * Get the service charge configured for
     * this device category.
     *
     * This is important because the service charge
     * is not exposed to the customer initially.
     */
    const [serviceCharge] = await db.select()
      .from(deviceServiceCharges).where(eq(deviceServiceCharges.deviceCategory, jobItem.deviceCategory)).limit(1);

    if (!serviceCharge) {
      return res.status(400).json({ error: `No service charge configured for category: ${jobItem.deviceCategory}` });
    }

    const preview = buildQuoteLineValues('preview', components);
    const serviceChargeAmount = Number(serviceCharge.chargeAmount);
    const totalAmount = preview.componentsCost + serviceChargeAmount;

    /**
     * Find the latest quote version so that
     * every new quote gets the next version.
     */
    const [latestQuote] = await db.select().from(jobItemQuotes).where(eq(jobItemQuotes.jobItemId, jobItem.id)).orderBy(desc(jobItemQuotes.version)).limit(1);

    const nextVersion =
      (latestQuote?.version ?? 0) + 1;

    let persistedQuote: { quoteId: string; lineCount: number; componentsCost: number; totalAmount: number } | null = null;

    const updatedJobItem =
      await updateJobItemWithStatusTransition(
        jobItem.id,
        jobItem.currentStatus,
        'awaiting_customer_approval',

        async (tx) => {
          const created = await insertJobItemQuoteWithLines(tx, {
            jobItemId: jobItem.id,
            version: nextVersion,
            components,
            serviceCharge: serviceCharge.chargeAmount,
            createdByUserId: csUserId,
            status: 'pending_customer_approval',
          });

          persistedQuote = { quoteId: created.quote.id, lineCount: created.lines.length, componentsCost: created.componentsCost, totalAmount: created.totalAmount };

          const [updated] = await tx
            .update(jobItems)
            .set({
              finalComponentsCost:
                moneyString(created.componentsCost),

              serviceChargeApplied:
                serviceCharge.chargeAmount,

              isFinalQuoteApproved: false,

              currentStatus:
                'awaiting_customer_approval',

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
        'Final quote generated successfully. Awaiting customer approval.',

      jobItem: updatedJobItem,

      quote: {
        id: (persistedQuote as {
          quoteId: string;
        } | null)?.quoteId,
        version: nextVersion,
        componentsCost: preview.componentsCost,
        serviceCharge:
          serviceChargeAmount,
        totalAmount,
        components: preview.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unitPrice: Number(line.unitPrice),
          lineTotal: Number(line.lineTotal),
        })),
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
export const getPendingFinalQuotesOnSite = async (req: Request, res: Response,) => {
  try {

    const rawData = await db.select({ jobs: jobs, jobItems: jobItems })
      .from(jobs)
      .innerJoin(jobItems, eq(jobs.id, jobItems.jobId))
      .where(eq(jobs.currentStatus, 'pending_final_quote_onsite'));

    const groupedData = new Map<string, { job: typeof jobs.$inferSelect; items: typeof jobItems.$inferSelect[] }>();

    for (const row of rawData) {
      const jobId = row.jobs.id;
      if (!groupedData.has(jobId)) {
        groupedData.set(jobId, { job: row.jobs, items: [] });
      }
      groupedData.get(jobId)?.items.push(row.jobItems);
    }


    return res.status(200).json({ count: groupedData.values.length + 1, items: Array.from(groupedData.values()), });
  } catch (error) {
    console.error('Fetch pending quotes error:', error,);

    return res.status(500).json({ error: 'Internal server error while fetching pending quotes', });
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
    /**
     * 1. At least one item must exist for the job.
     */
    const hasItems = db
      .select({
        id: jobItems.id,
      })
      .from(jobItems)
      .where(
        eq(
          jobItems.jobId,
          jobs.id,
        ),
      );

    /**
     * 2. There must NOT be an item whose
     *    status is something other than:
     *
     *    delivered
     *    repair_rejected
     */
    const hasNonFinalItems = db
      .select({
        id: jobItems.id,
      })
      .from(jobItems)
      .where(
        and(
          eq(
            jobItems.jobId,
            jobs.id,
          ),

          sql`${jobItems.currentStatus} NOT IN ('delivered', 'repair_rejected')`,
        ),
      );

    /**
     * Get all jobs that are ready to be closed.
     */
    const rows = await db
      .select({
        job: jobs,

        customerUser: {
          id: users.id,
          email: users.email,
          userType: users.userType,
          phone: users.phone,
          isActive: users.isActive,
          mustChangePassword:
            users.mustChangePassword,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        },

        customerProfile:
          customerProfiles,

        item: jobItems,
      })
      .from(jobs)

      .innerJoin(
        users,
        eq(
          jobs.customerId,
          users.id,
        ),
      )

      .leftJoin(
        customerProfiles,
        eq(
          customerProfiles.userId,
          users.id,
        ),
      )

      .leftJoin(
        jobItems,
        eq(
          jobItems.jobId,
          jobs.id,
        ),
      )

      .where(
        and(
          /**
           * Job must still be in progress.
           */
          eq(
            jobs.currentStatus,
            'in_progress',
          ),

          /**
           * Job must have at least one item.
           */
          exists(hasItems),

          /**
           * No non-final items are allowed.
           */
          notExists(hasNonFinalItems),
        ),
      );

    /**
     * Group the JOIN result.
     *
     * Because one job can have multiple items,
     * the SQL query returns one row per item.
     *
     * We convert that into:
     *
     * job
     * customer
     * items[]
     */
    const jobsMap = new Map<
      string,
      {
        job: typeof rows[number]['job'];
        customer: {
          user: typeof rows[number]['customerUser'];
          profile: typeof rows[number]['customerProfile'];
        };
        items: NonNullable<
          typeof rows[number]['item']
        >[];
      }
    >();

    for (const row of rows) {
      const jobId = row.job.id;

      if (!jobsMap.has(jobId)) {
        jobsMap.set(jobId, {
          job: row.job,

          customer: {
            user: row.customerUser,
            profile:
              row.customerProfile,
          },

          items: [],
        });
      }

      if (row.item) {
        jobsMap
          .get(jobId)!
          .items.push(row.item);
      }
    }

    const result = Array.from(
      jobsMap.values(),
    );

    return res.status(200).json({
      count: result.length,
      jobs: result,
    });
  } catch (error) {
    console.error(
      'Get jobs waiting to be closed error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error',
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
  req: Request<
    {},
    {},
    {
      jobId: string;
      closureReason?: string;
      customerConfirmed?: boolean;
      paymentConfirmed?: boolean;
    }
  >,
  res: Response,
) => {
  try {
    if (!req.user?.userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized',
      });
    }

    const userId = req.user.userId;

    const {
        jobId,
      customerConfirmed = false,
      paymentConfirmed = false,
      closureReason,
    } = req.body;



    if (!paymentConfirmed) {
      return res.status(400).json({
        error: 'Payment confirmation is required to close the job.',
      });
    }

    /**
     * First fetch the job and its items.
     */
    const rows = await db
      .select({
        job: jobs,
        customerUser: users,
        customerProfile: customerProfiles,
        item: jobItems,
      })
      .from(jobs)
      .innerJoin(
        users,
        eq(jobs.customerId, users.id),
      )
      .leftJoin(
        customerProfiles,
        eq(customerProfiles.userId, users.id),
      )
      .leftJoin(
        jobItems,
        eq(jobItems.jobId, jobs.id),
      )
      .where(eq(jobs.id, jobId));

    /**
     * Job doesn't exist.
     */
    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Job not found',
      });
    }

    const firstRow = rows[0];

    const job = firstRow.job;

    /**
     * Get all items belonging to the job.
     */
    const items = rows
      .map((row) => row.item)
      .filter(
        (item): item is NonNullable<typeof item> =>
          item !== null,
      );

    /**
     * --------------------------------------------------
     * VALIDATION 1
     * Job must be delivered before it can be closed.
     * --------------------------------------------------
     */
    if (job.currentStatus !== 'delivered') {
      return res.status(400).json({
        error: 'Job cannot be closed',
        message:
          `Job must be in delivered status before closing. ` +
          `Current status: ${job.currentStatus}`,
      });
    }

    /**
     * --------------------------------------------------
     * VALIDATION 2
     * Job must have at least one item.
     * --------------------------------------------------
     */
    if (items.length === 0) {
      return res.status(400).json({
        error: 'Job cannot be closed',
        message: 'Job must contain at least one item.',
      });
    }

    /**
     * --------------------------------------------------
     * VALIDATION 3
     *
     * Every item must be:
     *
     * delivered
     * OR
     * repair_rejected
     * --------------------------------------------------
     */
    const nonFinalItems = items.filter(
      (item) =>
        item.currentStatus !== 'delivered' &&
        item.currentStatus !== 'repair_rejected',
    );

    if (nonFinalItems.length > 0) {
      return res.status(400).json({
        error: 'Job cannot be closed',
        message:
          'All job items must be either delivered or repair_rejected.',
        nonFinalItems: nonFinalItems.map((item) => ({
          id: item.id,
          deviceCategory: item.deviceCategory,
          currentStatus: item.currentStatus,
        })),
      });
    }

    /**
     * --------------------------------------------------
     * VALIDATION 4
     * Customer confirmation.
     * --------------------------------------------------
     */
    if (!customerConfirmed) {
      return res.status(400).json({
        error: 'Customer confirmation is required.',
      });
    }

    /**
     * --------------------------------------------------
     * VALIDATION 5
     * Payment confirmation.
     * --------------------------------------------------
     */

    /**
     * --------------------------------------------------
     * TRANSACTION
     * --------------------------------------------------
     */
    const result = await db.transaction(async (tx) => {
      /**
       * Re-check the job status inside the transaction.
       *
       * This prevents two requests from closing the same job
       * at the same time.
       */
      const currentJob = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.currentStatus, 'delivered'),
          ),
        )
        .limit(1);

      if (currentJob.length === 0) {
        throw new Error(
          'Job is no longer in delivered status.',
        );
      }

      /**
       * Make sure a closure does not already exist.
       */
      const existingClosure = await tx
        .select({
          id: jobClosures.id,
        })
        .from(jobClosures)
        .where(eq(jobClosures.jobId, jobId))
        .limit(1);

      if (existingClosure.length > 0) {
        throw new Error(
          'Job has already been closed.',
        );
      }

      /**
       * Update job status:
       *
       * delivered → closed
       */
      const [updatedJob] = await tx
        .update(jobs)
        .set({
          currentStatus: 'closed',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.currentStatus, 'delivered'),
          ),
        )
        .returning();

      /**
       * Record job status history.
       */
      await tx
        .insert(jobStatusHistory)
        .values({
          jobId,
          previousStatus: 'delivered',
          newStatus: 'closed',
          changedBy: req.user?.userId,
          note: closureReason ?? 'Job closed',
        });

      if (!req.user?.userId) {
        return res.status(401).json({
          error: 'Unauthorized',
        });
      }


      const userId = req.user.userId;

      /**
       * Create closure record.
       */
      const [closure] = await tx
        .insert(jobClosures)
        .values({
          jobId,
          closedByUserId: userId,
          closingRemarks: closureReason ?? null,
          customerConfirmed,
        })
        .returning();

      /**
       * Create job-level comment.
       *
       * jobId is set.
       * jobItemId remains NULL.
       */
      const [comment] = await tx
        .insert(jobComments)
        .values({
          jobId,
          jobItemId: null,
          userId,
          comment: closureReason?? 'Job closed successfully.',
        })
        .returning();

      return {
        job: updatedJob,
        closure,
        comment,
      };
    });

    return res.status(200).json({
      message: 'Job closed successfully.',
      ...result,
    });

  } catch (error) {
    console.error(
      'Close job error:',
      error,
    );

    if (
      error instanceof Error &&
      (
        error.message ===
        'Job is no longer in delivered status.' ||
        error.message ===
        'Job has already been closed.'
      )
    ) {
      return res.status(409).json({
        error: error.message,
      });
    }

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};