import { Request, Response } from 'express';

import { and, asc, desc, eq, exists, ilike, inArray, notExists, or, sql } from 'drizzle-orm';

import { db } from '../../config/database.js';

import { jobs, jobItems, jobComments, jobStatusHistory, jobClosures, jobItemQuotes, deviceServiceCharges, jobItemQuoteLines, JobItemStatus, jobItemStatusHistory, JobSummaryStatus, users, customerProfiles, } from '../../db/schema/index.js';

import {
  GenerateFinalQuoteInput, CloseJobInput, CSApproveJobAndJobItemInput,
} from './cs.validation.js';

import { DbTransaction, updateJobItemWithStatusTransition } from '../jobstatusandtransitions/item-status-history.js';
import { buildQuoteLineValues, insertJobItemQuoteWithLines, moneyString, resolveQuoteComponents } from '../jobs/quote-components.js';
import { processCSJobApproval } from './service/approveJobsByCS.js';
import { allowedJobTransitions, canTransitionJob } from '../jobstatusandtransitions/status-history.js';
import { transitionJob } from '../jobstatusandtransitions/transition-job.js';



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
// after search for customer clik on customer so this functions return the customer with profile and all jobs submitted by customer
export const seacrhCustomerDetailswithJob = async (
  req: Request<CustomerParams>,
  res: Response
) => {
  try {
    const customerId = req.params.id;

    if (!customerId) {
      return res.status(400).json({ message: "Invalid customer ID", });
    }

    const rows = await db
      .select()
      .from(customerProfiles)
      .leftJoin(jobs, eq(jobs.customerId, customerId))
      .where(eq(customerProfiles.userId, customerId));


    const customerMap = new Map<
      string,
      {
        customerProfile: typeof rows[number]['customer_profiles'];
        jobs: typeof rows[number]['jobs'][];
      }
    >();

    for (const row of rows) {
      const customer = row.customer_profiles;
      const job = row.jobs;

      if (!customer) continue;

      const existingCustomer = customerMap.get(customer.userId);

      if (existingCustomer) {
        if (job) existingCustomer.jobs.push(job);
      } else {
        customerMap.set(customer.userId, {
          customerProfile: customer,
          jobs: job ? [job] : [],
        });
      }
    }

    const result = Array.from(customerMap.values());


    return res.status(200).json(result);
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Failed to get customer details",
    });
  }
};


// search the custmomer 
export const searchCustomers = async (
  req: Request,
  res: Response,
) => {
  try {
    const { q } = req.query;

    const search = String(q).trim();

    if (!search) {
      return res.status(400).json({
        status: 'error',
        message: 'Search query is required.',
      });
    }

    const customers = await db
      .select({
        customerId: users.id,
        firstName: customerProfiles.firstName,
        lastName: customerProfiles.lastName,
        email: users.email,
        phone: customerProfiles.phone,
      })
      .from(users)
      .innerJoin(
        customerProfiles,
        eq(
          customerProfiles.userId,
          users.id,
        ),
      )
      .leftJoin(
        jobs,
        eq(
          jobs.customerId,
          users.id,
        ),
      )
      .where(
        or(
          ilike(
            customerProfiles.firstName,
            `%${search}%`,
          ),

          ilike(
            customerProfiles.lastName,
            `%${search}%`,
          ),

          ilike(
            users.email,
            `%${search}%`,
          ),

          ilike(
            customerProfiles.phone,
            `%${search}%`,
          ),

          ilike(
            jobs.jobNumber,
            `%${search}%`,
          ),
        ),
      )
      .groupBy(
        users.id,
        customerProfiles.firstName,
        customerProfiles.lastName,
        users.email,
        customerProfiles.phone,
      );

    return res.status(200).json({
      status: 'success',
      data: customers,
    });

  } catch (error) {
    console.error(
      'Search customers error:',
      error,
    );

    return res.status(500).json({
      status: 'error',
      message: 'Failed to search customers.',
    });
  }
};


/**
 * CS team gets all jobs that are delivered
 * and ready to be closed.
 *
 * A job is ready to close when:
 * - It has at least one item
 * - Every item is either delivered or repair_rejected
 * - Job summary status is delivered
 */
export const getJobsWaitingToBeClosed = async (req: Request, res: Response,) => {
  try {
    const hasItems = db.select({ id: jobItems.id, })
      .from(jobItems)
      .where(eq(jobItems.jobId, jobs.id,),);

    /**
     * 2. There must NOT be an item whose
     *    status is something other than:
     *
     *    delivered
     *    repair_rejected
     */
    const hasNonFinalItems = db.select({ id: jobItems.id, })
      .from(jobItems)
      .where(and(eq(jobItems.jobId, jobs.id,),
        sql`${jobItems.currentStatus} NOT IN ('delivered', 'repair_rejected')`,
      ));

    /**
     * Get all jobs that are ready to be closed.
     */
    const rows = await db.select({
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

      customerProfile: customerProfiles,
      item: jobItems,
    })
      .from(jobs)
      .innerJoin(
        users, eq(jobs.customerId, users.id,),)

      .leftJoin(customerProfiles, eq(customerProfiles.userId, users.id,))
      .leftJoin(jobItems, eq(jobItems.jobId, jobs.id,),)

      .where(and(eq(jobs.currentStatus, 'delivered',),
        exists(hasItems),
        /**
         * No non-final items are allowed.
         */
        notExists(hasNonFinalItems),),
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
        jobsMap.get(jobId)!.items.push(row.item);
      }
    }

    const result = Array.from(jobsMap.values(),);

    return res.status(200).json({ count: result.length, jobs: result, });
  } catch (error) {
    console.error('Get jobs waiting to be closed error:', error,);

    return res.status(500).json({ error: 'Internal server error', });
  }
};

// --------------------------------------------------
// Cs team talks with the customer confirms if the delivery happnened and closes the job
// --------------------------------------------------

export const closeJobRequest = async (
  req: Request<{}, {}, CloseJobInput>,
  res: Response,
) => {
  try {

    // --------------------------------------------------
    // AUTHENTICATION
    // --------------------------------------------------

    if (!req.user?.userId) {
      return res.status(401).json({
        status: 'error',
        message: 'Unauthorized',
      });
    }

    const userId = req.user.userId;


    // --------------------------------------------------
    // REQUEST BODY
    // --------------------------------------------------

    const {
      jobId,
      customerConfirmed,
      paymentConfirmed,
      closureReason,
    } = req.body;


    // --------------------------------------------------
    // VALIDATION 1
    // Payment confirmation from frontend
    // --------------------------------------------------

    if (!paymentConfirmed) {
      return res.status(400).json({
        status: 'error',
        error:
          'Payment confirmation is required to close the job.',
      });
    }


    // --------------------------------------------------
    // VALIDATION 2
    // Customer confirmation
    // --------------------------------------------------

    if (!customerConfirmed) {
      return res.status(400).json({
        status: 'error',
        error:
          'Customer confirmation is required.',
      });
    }


    // --------------------------------------------------
    // FETCH JOB + ITEMS
    // --------------------------------------------------

    const rows = await db
      .select({
        job: jobs,
        item: jobItems,
      })
      .from(jobs)
      .leftJoin(
        jobItems,
        eq(
          jobItems.jobId,
          jobs.id,
        ),
      )
      .where(
        eq(
          jobs.id,
          jobId,
        ),
      );


    // --------------------------------------------------
    // JOB NOT FOUND
    // --------------------------------------------------

    if (rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        error: 'Job not found',
      });
    }


    const job = rows[0].job;


    // --------------------------------------------------
    // GET JOB ITEMS
    // --------------------------------------------------

    const items = rows
      .map(
        (row) => row.item,
      )
      .filter(
        (
          item,
        ): item is NonNullable<typeof item> =>
          item !== null,
      );


    // --------------------------------------------------
    // VALIDATION 3
    //
    // Job must transition:
    //
    // delivered -> closed
    // --------------------------------------------------

    if (
      !canTransitionJob(
        job.currentStatus,
        'closed',
      )
    ) {
      return res.status(400).json({
        status: 'error',
        error:
          'Job cannot be closed.',

        message:
          `Job cannot transition from ` +
          `${job.currentStatus} to closed.`,
      });
    }


    // --------------------------------------------------
    // VALIDATION 4
    //
    // Job must contain at least one item.
    // --------------------------------------------------

    if (items.length === 0) {
      return res.status(400).json({
        status: 'error',
        error:
          'Job cannot be closed.',

        message:
          'Job must contain at least one item.',
      });
    }


    // --------------------------------------------------
    // VALIDATION 5
    //
    // Every item must be:
    //
    // delivered
    // OR
    // repair_rejected
    // --------------------------------------------------

    const nonFinalItems = items.filter(
      (item) =>
        item.currentStatus !== 'delivered' &&
        item.currentStatus !== 'repair_rejected',
    );


    if (nonFinalItems.length > 0) {
      return res.status(400).json({
        status: 'error',

        error:
          'Job cannot be closed.',

        message:
          'All job items must be either delivered or repair_rejected.',

        nonFinalItems:
          nonFinalItems.map(
            (item) => ({
              id: item.id,

              deviceCategory:
                item.deviceCategory,

              currentStatus:
                item.currentStatus,
            }),
          ),
      });
    }


    // --------------------------------------------------
    // TRANSACTION
    // --------------------------------------------------

    const result = await db.transaction(
      async (tx) => {

        // --------------------------------------------------
        // Re-fetch job inside transaction
        // --------------------------------------------------

        const [currentJob] =
          await tx
            .select()
            .from(jobs)
            .where(
              and(
                eq(
                  jobs.id,
                  jobId,
                ),

                eq(
                  jobs.currentStatus,
                  'delivered',
                ),
              ),
            )
            .limit(1);


        if (!currentJob) {
          throw new Error(
            'Job is no longer in delivered status.',
          );
        }


        // --------------------------------------------------
        // Re-check transition
        // --------------------------------------------------

        if (
          !canTransitionJob(
            currentJob.currentStatus,
            'closed',
          )
        ) {
          throw new Error(
            `Job cannot transition from ` +
            `${currentJob.currentStatus} to closed.`,
          );
        }


        // --------------------------------------------------
        // Check if already closed
        // --------------------------------------------------

        const [existingClosure] =
          await tx
            .select({
              id: jobClosures.id,
            })
            .from(jobClosures)
            .where(
              eq(
                jobClosures.jobId,
                jobId,
              ),
            )
            .limit(1);


        if (existingClosure) {
          throw new Error(
            'Job has already been closed.',
          );
        }


        // --------------------------------------------------
        // JOB TRANSITION
        //
        // delivered -> closed
        //
        // transitionJob handles:
        //
        // 1. jobs update
        // 2. jobStatusHistory
        // 3. jobComments
        // --------------------------------------------------

        const updatedJob =
          await transitionJob({
            jobId,

            previousStatus:
              currentJob.currentStatus,

            newStatus:
              'closed',

            changedBy:
              userId,

            note:
              closureReason ??
              'Job closed successfully.',

            existingTx:
              tx,

            updateJob: (tx: DbTransaction) =>
              tx
                .update(jobs)
                .set({
                  currentStatus:
                    'closed',

                  updatedAt:
                    new Date(),
                })
                .where(
                  and(
                    eq(
                      jobs.id,
                      jobId,
                    ),

                    eq(
                      jobs.currentStatus,
                      currentJob.currentStatus,
                    ),
                  ),
                )
                .returning(),
          });


        // --------------------------------------------------
        // JOB CLOSURE
        //
        // This is NOT part of the generic transition
        // helper because it is specific to closing.
        // --------------------------------------------------

        const [closure] =
          await tx
            .insert(jobClosures)
            .values({
              jobId,

              closedByUserId:
                userId,

              closingRemarks: closureReason,

              customerConfirmed:
                customerConfirmed,
            })
            .returning();


        return {
          job: updatedJob,
          closure,
        };
      },
    );


    // --------------------------------------------------
    // SUCCESS
    // --------------------------------------------------

    return res.status(200).json({
      status: 'success',

      message:
        'Job closed successfully.',

      ...result,
    });


  } catch (error) {

    console.error(
      'Close job error:',
      error,
    );


    // --------------------------------------------------
    // EXPECTED CONCURRENCY ERRORS
    // --------------------------------------------------

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
        status: 'error',
        error: error.message,
      });
    }


    // --------------------------------------------------
    // INVALID TRANSITION
    // --------------------------------------------------

    if (
      error instanceof Error &&
      error.message.startsWith(
        'Invalid job status transition:',
      )
    ) {
      return res.status(400).json({
        status: 'error',
        error: error.message,
      });
    }


    // --------------------------------------------------
    // INTERNAL ERROR
    // --------------------------------------------------

    return res.status(500).json({
      status: 'error',
      error: 'Internal server error',
    });
  }
};

// the job submitted by customer the cs team will have a look and approve the job
export const approveJobByCS = async (req: Request<{}, {}, CSApproveJobAndJobItemInput>,res: Response,) => {
  try {
    const csUserId =
      req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({
        status: 'error',

        message:
          'Authenticated CS user is required',
      });
    }

    const result =
      await processCSJobApproval(
        req.body,
        csUserId,
      );
      
    return res.status(200).json({
      status: 'success',

      message:
        result.decision === 'approved'
          ? 'CS job verification approved successfully.'
          : 'CS job verification rejected successfully.',

      decision:
        result.decision,

      job:
        result.job,

      jobItems:
        result.jobItems,

      jobQuote:
        result.jobQuote,
    });

  } catch (error) {

    console.error(
      'CS job approval error:',
      error,
    );

    return res.status(400).json({
      status: 'error',

      message:
        error instanceof Error
          ? error.message
          : 'Failed to process CS job verification',
    });
  }
};
interface JobParams {
  id: string;
}

//get all job with jobitem and job status history and job item -status history

export const getjobDetails = async (req: Request<JobParams>, res: Response) => {
  try {
    const jobId = req.params.id;
    if (!jobId) {
      return res.status(400).json({ message: "Invalid job ID", });
    }
    const jobResult = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (jobResult.length === 0) {
      return res.status(404).json({ message: "Job not found", });
    }
    const job = jobResult[0];
    const items = await db.select().from(jobItems).where(eq(jobItems.jobId, jobId));

    const jobHistory = await db.select().from(jobStatusHistory).where(eq(jobStatusHistory.jobId, jobId)).orderBy(desc(jobStatusHistory.createdAt));
    const jobItemIds = items.map((item) => item.id);

    const itemHistories = jobItemIds.length > 0
      ? await db
        .select()
        .from(jobItemStatusHistory)
        .where(inArray(jobItemStatusHistory.jobItemId, jobItemIds))
        .orderBy(desc(jobItemStatusHistory.createdAt))
      : [];

    const historiesByItem = new Map<string, typeof itemHistories>();

    for (const history of itemHistories) {
      const existing = historiesByItem.get(history.jobItemId) ?? [];

      existing.push(history);

      historiesByItem.set(history.jobItemId, existing);
    }
    const itemsWithHistory = items.map((item) => ({
      ...item,
      history: historiesByItem.get(item.id) ?? [],
    }));
     return res.status(200).json({
      job,
      jobHistory,
      items: itemsWithHistory,
    });

  } catch (err) {

    console.log(err)
    res.status(500).json({ eroor: err, message: "Get Job Details Failed" });
  }
}





//done























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
      .where(eq(jobs.currentStatus, 'repair_started'));

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
// export const getPendingOnsiteConfirmations = async (
//   req: Request,
//   res: Response,
// ) => {
//   try {
//     const items = await db
//       .select({
//         job: jobs,
//         jobItem: jobItems,
//       })
//       .from(jobItems)
//       .innerJoin(
//         jobs,
//         eq(jobItems.jobId, jobs.id),
//       )
//       .where(
//         eq(
//           jobItems.currentStatus,
//           'pending_cs_confirmation',
//         ),
//       )
//       .orderBy(
//         asc(jobItems.updatedAt),
//       );

//     return res.status(200).json({
//       count: items.length,
//       items,
//     });
//   } catch (error) {
//     console.error(
//       'Get pending onsite confirmations error:',
//       error,
//     );

//     return res.status(500).json({
//       error: 'Internal server error',
//     });
//   }
// };

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
// export const confirmOnsiteRepair = async (
//   req: Request<
//     {},
//     {},
//     ConfirmOnsiteRepairInput
//   >,
//   res: Response,
// ) => {
//   try {
//     const csUserId = req.user?.userId;

//     if (!csUserId) {
//       return res.status(401).json({
//         error: 'Authentication required',
//       });
//     }

//     const {
//       jobItemId,
//       customerConfirmed,
//       comment,
//     } = req.body;

//     if (!customerConfirmed) {
//       return res.status(400).json({
//         error:
//           'Customer confirmation is required.',
//       });
//     }

//     const [item] = await db
//       .select()
//       .from(jobItems)
//       .where(eq(jobItems.id, jobItemId))
//       .limit(1);

//     if (!item) {
//       return res.status(404).json({
//         error: 'Job item not found',
//       });
//     }

//     if (
//       item.currentStatus !==
//       'pending_cs_confirmation'
//     ) {
//       return res.status(400).json({
//         error:
//           `Cannot confirm onsite repair from status '${item.currentStatus}'.`,
//       });
//     }

//     if (
//       item.repairLocation !==
//       'customer_site'
//     ) {
//       return res.status(400).json({
//         error:
//           'This item is not an onsite repair item.',
//       });
//     }

//     const updatedItem =
//       await updateJobItemWithStatusTransition(
//         item.id,
//         item.currentStatus,
//         'ready_for_delivery',

//         async (tx) => {
//           const [result] = await tx
//             .update(jobItems)
//             .set({
//               currentStatus:
//                 'ready_for_delivery',

//               isFinalQuoteApproved: true,

//               updatedAt: new Date(),
//             })
//             .where(
//               eq(
//                 jobItems.id,
//                 jobItemId,
//               ),
//             )
//             .returning();

//           return result;
//         },

//         csUserId,
//         comment.trim(),
//       );

//     return res.status(200).json({
//       message:
//         'Onsite repair has been confirmed with the customer.',
//       item: updatedItem,
//     });
//   } catch (error) {
//     console.error(
//       'Confirm onsite repair error:',
//       error,
//     );

//     return res.status(500).json({
//       error: 'Internal server error',
//     });
//   }
// };

