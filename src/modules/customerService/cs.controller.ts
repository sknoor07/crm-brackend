import { Request, Response } from 'express';

import { and, asc, desc, eq, exists, ilike, inArray, notExists, or, sql } from 'drizzle-orm';

import { db } from '../../config/database.js';

import { jobs, jobItems, jobComments, jobStatusHistory, jobClosures, jobItemQuotes, deviceServiceCharges, jobItemQuoteLines, JobItemStatus, jobItemStatusHistory, JobSummaryStatus, users, customerProfiles, jobQuotes, } from '../../db/schema/index.js';

import {
  GenerateFinalQuoteInput, CloseJobInput, CSApproveJobAndJobItemInput,
} from './cs.validation.js';

import { updateJobItemWithStatusTransition } from '../jobstatusandtransitions/item-status-history.js';
import { buildQuoteLineValues, insertJobItemQuoteWithLines, moneyString, resolveQuoteComponents } from '../jobs/quote-components.js';
import { calculateServiceCharge, processCSJobApproval } from './service/approveJobsByCS.js';
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
export const approveJobByCS = async (req: Request<{}, {}, CSApproveJobAndJobItemInput>, res: Response,) => {
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

/*
* Both onsite and lab items can require a final quote.
*/


type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export const getPendingFinalQuotes = async (
  req: Request,
  res: Response,
) => {
  try {
    // --------------------------------------------------
    // 1. Get jobs waiting for final quote
    // --------------------------------------------------

    const jobsPendingQuote = await db
      .select({
        job: jobs,
        customer: customerProfiles,
      })
      .from(jobs)
      .leftJoin(
        customerProfiles,
        eq(customerProfiles.userId, jobs.customerId),
      )
      .where(
        eq(
          jobs.currentStatus,
          'pending_final_quote',
        ),
      )
      .orderBy(desc(jobs.updatedAt));

    if (jobsPendingQuote.length === 0) {
      return res.status(200).json({
        status: 'success',
        count: 0,
        jobs: [],
      });
    }

    const jobIds = jobsPendingQuote.map(
      ({ job }) => job.id,
    );

    // --------------------------------------------------
    // 2. Get ONLY items pending final quote
    // --------------------------------------------------

    const pendingQuoteItems = await db
      .select()
      .from(jobItems)
      .where(
        and(
          inArray(jobItems.jobId, jobIds),
          eq(
            jobItems.currentStatus,
            'pending_final_quote',
          ),
        ),
      )
      .orderBy(desc(jobItems.updatedAt));

    const itemIds = pendingQuoteItems.map(
      (item) => item.id,
    );

    // --------------------------------------------------
    // 3. Get latest comments for jobs/items
    // --------------------------------------------------

    const comments =
      jobIds.length > 0 || itemIds.length > 0
        ? await db
          .select({
            id: jobComments.id,
            jobId: jobComments.jobId,
            jobItemId: jobComments.jobItemId,
            userId: jobComments.userId,
            comment: jobComments.comment,
            createdAt: jobComments.createdAt,
          })
          .from(jobComments)
          .where(
            or(
              inArray(
                jobComments.jobId,
                jobIds,
              ),
              itemIds.length > 0
                ? inArray(
                  jobComments.jobItemId,
                  itemIds,
                )
                : undefined,
            ),
          )
          .orderBy(
            desc(jobComments.createdAt),
            desc(jobComments.id),
          )
        : [];

    // --------------------------------------------------
    // 4. Keep latest comment per job/item
    // --------------------------------------------------

    const latestJobComments = new Map<
      string,
      (typeof comments)[number]
    >();

    const latestItemComments = new Map<
      string,
      (typeof comments)[number]
    >();

    for (const comment of comments) {
      if (
        comment.jobId &&
        !latestJobComments.has(comment.jobId)
      ) {
        latestJobComments.set(
          comment.jobId,
          comment,
        );
      }

      if (
        comment.jobItemId &&
        !latestItemComments.has(
          comment.jobItemId,
        )
      ) {
        latestItemComments.set(
          comment.jobItemId,
          comment,
        );
      }
    }

    // --------------------------------------------------
    // 5. Helper
    // --------------------------------------------------

    const toLatestComment = (
      comment:
        | (typeof comments)[number]
        | undefined,
    ) =>
      comment
        ? {
          id: comment.id,
          userId: comment.userId,
          comment: comment.comment,
          createdAt: comment.createdAt,
        }
        : null;

    // --------------------------------------------------
    // 6. Group items by job
    // --------------------------------------------------

    const itemsByJobId = new Map<
      string,
      typeof pendingQuoteItems
    >();

    for (const item of pendingQuoteItems) {
      const existing =
        itemsByJobId.get(item.jobId);

      if (existing) {
        existing.push(item);
      } else {
        itemsByJobId.set(
          item.jobId,
          [item],
        );
      }
    }

    // --------------------------------------------------
    // 7. Build response
    // --------------------------------------------------

    const result = jobsPendingQuote.map(
      ({ job, customer }) => {
        const items =
          itemsByJobId.get(job.id) ?? [];

        return {
          job: {
            ...job,
            latestComment:
              toLatestComment(
                latestJobComments.get(job.id),
              ),
          },

          customer,

          items: items.map((item) => ({
            ...item,

            latestComment:
              toLatestComment(
                latestItemComments.get(
                  item.id,
                ),
              ),
          })),
        };
      },
    );

    // --------------------------------------------------
    // 8. Response
    // --------------------------------------------------

    return res.status(200).json({
      status: 'success',
      count: result.length,
      jobs: result,
    });
  } catch (error) {
    console.error(
      'Error fetching jobs pending final quote:',
      error,
    );

    return res.status(500).json({
      status: 'error',
      message:
        'Failed to fetch jobs pending final quote',
    });
  }
};


export const generateFinalQuote = async (
  req: Request<{}, {}, GenerateFinalQuoteInput>,
  res: Response,
) => {
  try {
    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({
        message: 'Unauthorized',
      });
    }

    const {
      jobId,
      items,
      comment,
      discount = 0,
      tax = 0,
    } = req.body;

    const jobComment =
      comment?.trim() ||
      'Final quote generated';

    const result = await db.transaction(async (tx) => {
      // --------------------------------------------------
      // 1. Get job
      // --------------------------------------------------

      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job) {
        throw new Error('Job not found');
      }

      // --------------------------------------------------
      // 2. Job must be pending final quote
      // --------------------------------------------------

      if (
        job.currentStatus !==
        'pending_final_quote'
      ) {
        throw new Error(
          `Final quote can only be generated when job status is pending_final_quote. Current status: ${job.currentStatus}`,
        );
      }

      // --------------------------------------------------
      // 3. Get ALL job items
      // --------------------------------------------------

      const existingItems = await tx
        .select()
        .from(jobItems)
        .where(
          eq(jobItems.jobId, jobId),
        );

      if (existingItems.length === 0) {
        throw new Error(
          'Cannot generate final quote because the job has no items',
        );
      }

      // --------------------------------------------------
      // 4. Every job item must be pending_final_quote
      // --------------------------------------------------

      const notReadyItems =
        existingItems.filter(
          (item) =>
            item.currentStatus !==
            'pending_final_quote',
        );

      if (notReadyItems.length > 0) {
        throw new Error(
          'Final quote cannot be generated because all job items must be in pending_final_quote status. ' +
          `Items not ready: ${notReadyItems
            .map(
              (item) =>
                `${item.id} (${item.currentStatus})`,
            )
            .join(', ')}`,
        );
      }

      // --------------------------------------------------
      // 5. Validate submitted items
      //
      // CS can only update components of existing items.
      // --------------------------------------------------

      if (items.length !== existingItems.length) {
        throw new Error(
          'All job items must be included in the final quote',
        );
      }

      const existingItemMap = new Map(
        existingItems.map((item) => [
          item.id,
          item,
        ]),
      );

      const submittedItemIds = new Set<string>();

      for (const inputItem of items) {
        // ----------------------------------------------
        // Item must belong to this job
        // ----------------------------------------------

        const existingItem =
          existingItemMap.get(
            inputItem.jobItemId,
          );

        if (!existingItem) {
          throw new Error(
            `Job item ${inputItem.jobItemId} does not belong to this job`,
          );
        }

        // ----------------------------------------------
        // Item must still be pending final quote
        // ----------------------------------------------

        if (
          existingItem.currentStatus !==
          'pending_final_quote'
        ) {
          throw new Error(
            `Job item ${inputItem.jobItemId} is not in pending_final_quote status`,
          );
        }

        // ----------------------------------------------
        // Prevent duplicate item entries
        // ----------------------------------------------

        if (
          submittedItemIds.has(
            inputItem.jobItemId,
          )
        ) {
          throw new Error(
            `Job item ${inputItem.jobItemId} was submitted more than once`,
          );
        }

        submittedItemIds.add(
          inputItem.jobItemId,
        );
      }

      // --------------------------------------------------
      // 6. Make sure no existing item was omitted
      // --------------------------------------------------

      for (const existingItem of existingItems) {
        if (
          !submittedItemIds.has(
            existingItem.id,
          )
        ) {
          throw new Error(
            `Job item ${existingItem.id} is missing from the final quote`,
          );
        }
      }

      // --------------------------------------------------
      // 7. Get latest quote version
      // --------------------------------------------------

      const [latestQuote] = await tx
        .select()
        .from(jobQuotes)
        .where(
          eq(
            jobQuotes.jobId,
            jobId,
          ),
        )
        .orderBy(
          desc(jobQuotes.version),
        )
        .limit(1);

      const nextVersion =
        (latestQuote?.version ?? 0) + 1;

      // --------------------------------------------------
      // 8. Create job quote
      // --------------------------------------------------

      const [jobQuote] = await tx
        .insert(jobQuotes)
        .values({
          jobId,
          version: nextVersion,

          subtotal: '0.00',
          serviceCharge: '0.00',

          discount: Number(discount).toFixed(2),
          tax: Number(tax).toFixed(2),

          totalAmount: '0.00',

          createdByUserId: csUserId,

          status: 'pending',
        })
        .returning();

      let subtotal = 0;
      let totalServiceCharge = 0;

      // --------------------------------------------------
      // 9. Create quote for every existing job item
      // --------------------------------------------------

      for (const inputItem of items) {
        const existingItem =
          existingItemMap.get(
            inputItem.jobItemId,
          )!;

        // ----------------------------------------------
        // Calculate service charge from existing item
        //
        // No job item fields are modified here.
        // ----------------------------------------------

        const serviceCharge =
          await calculateServiceCharge(
            existingItem,
            tx,
          );

        // ----------------------------------------------
        // Create quote item + components
        //
        // Components come from CS request.
        // This allows CS to:
        // - add components
        // - remove components
        // - edit quantity
        // - edit unit price
        // ----------------------------------------------

        const quoteResult =
          await insertJobItemQuoteWithLines(
            tx,
            {
              jobQuoteId:
                jobQuote.id,

              jobItemId:
                existingItem.id,

              components:
                inputItem.components ?? [],

              serviceCharge,

              createdByUserId:
                csUserId,
            },
          );

        subtotal +=
          quoteResult.componentsCost;

        totalServiceCharge +=
          quoteResult.serviceChargeAmount;

        // ----------------------------------------------
        // Move item to customer approval
        // ----------------------------------------------

        await updateJobItemWithStatusTransition(
          existingItem.id,
          'pending_final_quote',
          'awaiting_customer_approval',
          async (transaction) => {
            const [updatedItem] = await transaction
              .update(jobItems)
              .set({
                currentStatus:
                  'awaiting_customer_approval',

                finalComponentsCost:
                  quoteResult.componentsCost.toFixed(2),

                serviceChargeApplied:
                  quoteResult.serviceChargeAmount.toFixed(2),

                isFinalQuoteApproved: false,

                onsiteRepairAuthorized:
                  existingItem.onsiteRepairAuthorized,

                inlabRepairAuthorized:
                  existingItem.inlabRepairAuthorized,

                updatedAt: new Date(),
              })
              .where(
                eq(jobItems.id, existingItem.id),
              )
              .returning();

            return updatedItem;
          },
          csUserId,
          'Final quote generated for item.',
          tx,
        );
      }

      // --------------------------------------------------
      // 10. Calculate quote totals
      // --------------------------------------------------

      const finalSubtotal =
        Math.round(
          subtotal * 100,
        ) / 100;

      const finalServiceCharge =
        Math.round(
          totalServiceCharge * 100,
        ) / 100;

      const finalDiscount =
        Math.round(
          Number(discount) * 100,
        ) / 100;

      const finalTax =
        Math.round(
          Number(tax) * 100,
        ) / 100;

      const totalAmount =
        Math.round(
          (
            finalSubtotal +
            finalServiceCharge -
            finalDiscount +
            finalTax
          ) * 100,
        ) / 100;

      // --------------------------------------------------
      // 11. Update quote totals
      // --------------------------------------------------

      const [updatedQuote] =
        await tx
          .update(jobQuotes)
          .set({
            subtotal:
              finalSubtotal.toFixed(2),

            serviceCharge:
              finalServiceCharge.toFixed(2),

            discount:
              finalDiscount.toFixed(2),

            tax:
              finalTax.toFixed(2),

            totalAmount:
              totalAmount.toFixed(2),
          })
          .where(
            eq(
              jobQuotes.id,
              jobQuote.id,
            ),
          )
          .returning();

      // --------------------------------------------------
      // 12. Job-level audit comment
      //
      // IMPORTANT:
      // Job status remains pending_final_quote.
      // --------------------------------------------------

      await tx
        .insert(jobComments)
        .values({
          jobId,

          jobItemId: null,

          userId: csUserId,

          comment: jobComment,
        });

      // --------------------------------------------------
      // 13. Return
      // --------------------------------------------------

      return {
        job: {
          id: job.id,

          // Job DOES NOT change status
          currentStatus:
            job.currentStatus,
        },

        quote: updatedQuote,

        totals: {
          subtotal:
            finalSubtotal,

          serviceCharge:
            finalServiceCharge,

          discount:
            finalDiscount,

          tax:
            finalTax,

          totalAmount,
        },
      };
    });

    return res.status(200).json({
      message:
        'Final quote generated successfully',

      data: result,
    });
  } catch (error) {
    console.error(
      'generateFinalQuote error:',
      error,
    );

    return res.status(400).json({
      message:
        error instanceof Error
          ? error.message
          : 'Failed to generate final quote',
    });
  }
};
















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

/**
 * ============================================================
 * CS - GET PENDING FINAL QUOTES
 * ============================================================

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

