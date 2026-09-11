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
export const getPendingFinalQuotes = async (req: Request, res: Response,) => {
  try { const rows = await db.select({ job: jobs, item: jobItems, customer: customerProfiles, }).from(jobs).innerJoin(jobItems, eq(jobItems.jobId, jobs.id),).leftJoin(customerProfiles, eq(customerProfiles.userId, jobs.customerId,),).where(and(eq(jobs.currentStatus, 'pending_final_quote_onsite',), or(eq(jobItems.currentStatus, 'pending_final_quote',), eq(jobItems.currentStatus, 'repair_rejected',),),),).orderBy(desc(jobItems.updatedAt),); if (rows.length === 0) { return res.status(200).json({ status: 'success', count: 0, jobs: [], }); } const jobIds = [...new Set(rows.map((row) => row.job.id,),),]; const itemIds = [...new Set(rows.map((row) => row.item.id,),),]; const comments = jobIds.length > 0 ? await db.select({ id: jobComments.id, jobId: jobComments.jobId, jobItemId: jobComments.jobItemId, userId: jobComments.userId, comment: jobComments.comment, createdAt: jobComments.createdAt, }).from(jobComments).where(or(inArray(jobComments.jobId, jobIds,), inArray(jobComments.jobItemId, itemIds,),),).orderBy(desc(jobComments.createdAt,), desc(jobComments.id),) : []; const latestJobComments = new Map<string, (typeof comments)[number]>(); const latestItemComments = new Map<string, (typeof comments)[number]>(); for (const comment of comments) { if (comment.jobId && !latestJobComments.has(comment.jobId,)) { latestJobComments.set(comment.jobId, comment,); } if (comment.jobItemId && !latestItemComments.has(comment.jobItemId,)) { latestItemComments.set(comment.jobItemId, comment,); } } const allQuotes = await db.select().from(jobQuotes).where(inArray(jobQuotes.jobId, jobIds,),).orderBy(desc(jobQuotes.version),); const latestQuoteByJobId = new Map<string, (typeof allQuotes)[number]>(); for (const quote of allQuotes) { if (!latestQuoteByJobId.has(quote.jobId,)) { latestQuoteByJobId.set(quote.jobId, quote,); } } const latestQuoteIds = [...latestQuoteByJobId.values(),].map((quote) => quote.id,); const quoteItems = latestQuoteIds.length > 0 ? await db.select({ quoteItem: jobItemQuotes, jobItem: jobItems, }).from(jobItemQuotes).innerJoin(jobItems, eq(jobItems.id, jobItemQuotes.jobItemId,),).where(inArray(jobItemQuotes.jobQuoteId, latestQuoteIds,),) : []; const quoteItemIds = quoteItems.map((row) => row.quoteItem.id,); const quoteLines = quoteItemIds.length > 0 ? await db.select().from(jobItemQuoteLines).where(inArray(jobItemQuoteLines.quoteId, quoteItemIds,),).orderBy(jobItemQuoteLines.sortOrder,) : []; const quoteLinesByQuoteItemId = new Map<string, typeof quoteLines>(); for (const line of quoteLines) { const existing = quoteLinesByQuoteItemId.get(line.quoteId,); if (existing) { existing.push(line); } else { quoteLinesByQuoteItemId.set(line.quoteId, [line],); } } const groupedJobs = new Map<string, { job: typeof rows[number]['job']; customer: typeof rows[number]['customer']; items: typeof rows[number]['item'][]; }>(); for (const row of rows) { const existing = groupedJobs.get(row.job.id,); if (existing) { existing.items.push(row.item,); } else { groupedJobs.set(row.job.id, { job: row.job, customer: row.customer, items: [row.item], },); } } const toLatestComment = (comment: | (typeof comments)[number] | undefined,) => comment ? { id: comment.id, userId: comment.userId, comment: comment.comment, createdAt: comment.createdAt, } : null; const result = Array.from(groupedJobs.values(),).map(({ job, customer, items, }) => { const itemsWithLatestComment = items.map((item) => ({ ...item, latestComment: toLatestComment(latestItemComments.get(item.id,),), }),); const quoteRequiredItems = itemsWithLatestComment.filter((item) => item.currentStatus === 'pending_final_quote',); const rejectedItems = itemsWithLatestComment.filter((item) => item.currentStatus === 'repair_rejected',); const allItemsRejected = items.length > 0 && items.every((item) => item.currentStatus === 'repair_rejected',); const latestQuote = latestQuoteByJobId.get(job.id,); const quotedItems = latestQuote ? quoteItems.filter((quoteItem) => quoteItem.quoteItem.jobQuoteId === latestQuote.id,).map(({ quoteItem, jobItem, }) => { const lines = quoteLinesByQuoteItemId.get(quoteItem.id,) ?? []; return { jobItemId: quoteItem.jobItemId, deviceCategory: jobItem.deviceCategory, deviceSerialNumber: jobItem.deviceSerialNumber, issueDescription: jobItem.issueDescription, issueCategory: jobItem.issueCategory, repairLocation: jobItem.repairLocation, currentStatus: jobItem.currentStatus, components: lines.map((line) => ({ name: line.name, quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal, }),), componentsCost: quoteItem.componentsCost, serviceCharge: quoteItem.serviceCharge, totalAmount: quoteItem.totalAmount, }; },) : []; return { job: { ...job, latestComment: toLatestComment(latestJobComments.get(job.id,),), }, customer, latestQuote: latestQuote ? { id: latestQuote.id, jobId: latestQuote.jobId, version: latestQuote.version, status: latestQuote.status, subtotal: latestQuote.subtotal, serviceCharge: latestQuote.serviceCharge, discount: latestQuote.discount, tax: latestQuote.tax, totalAmount: latestQuote.totalAmount, createdByUserId: latestQuote.createdByUserId, createdAt: latestQuote.createdAt, } : null, quotedItems, items: itemsWithLatestComment, quoteRequiredItems, rejectedItems, allItemsRejected, }; },); return res.status(200).json({ status: 'success', count: result.length, jobs: result, }); } catch (error) { console.error('Error fetching jobs pending final quote:', error,); return res.status(500).json({ status: 'error', message: 'Failed to fetch jobs pending final quote', }); }
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
      addedItems,
      removedItemIds,
      comment,
      discount,
      tax,
    } = req.body;

    const result = await db.transaction(async (tx) => {
      // =========================================================
      // 1. Load job
      // =========================================================

      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job) {
        throw new Error('Job not found');
      }

      if (
        job.currentStatus !==
        'pending_final_quote_onsite'
      ) {
        throw new Error(
          `Final quote cannot be generated while job is in ${job.currentStatus} status`,
        );
      }

      // =========================================================
      // 2. Load all existing items
      // =========================================================

      const existingItems = await tx
        .select()
        .from(jobItems)
        .where(eq(jobItems.jobId, jobId));

      const existingItemMap = new Map(
        existingItems.map((item) => [
          item.id,
          item,
        ]),
      );

      // =========================================================
      // 3. Validate included existing items
      // =========================================================

      for (const inputItem of items) {
        const existingItem =
          existingItemMap.get(
            inputItem.jobItemId,
          );

        if (!existingItem) {
          throw new Error(
            `Job item ${inputItem.jobItemId} does not belong to this job`,
          );
        }

        if (
          existingItem.currentStatus !==
          'pending_final_quote'
        ) {
          throw new Error(
            `Job item ${inputItem.jobItemId} cannot be included in the final quote from status ${existingItem.currentStatus}`,
          );
        }
      }

      // =========================================================
      // 4. Validate removed items
      // =========================================================

      for (const jobItemId of removedItemIds) {
        const existingItem =
          existingItemMap.get(jobItemId);

        if (!existingItem) {
          throw new Error(
            `Job item ${jobItemId} does not belong to this job`,
          );
        }

        if (
          existingItem.currentStatus !==
          'pending_final_quote'
        ) {
          throw new Error(
            `Job item ${jobItemId} cannot be removed from the final quote from status ${existingItem.currentStatus}`,
          );
        }
      }

      // =========================================================
      // 5. Prevent include + remove conflict
      // =========================================================

      const includedItemIds = new Set(
        items.map(
          (item) => item.jobItemId,
        ),
      );

      for (const removedItemId of removedItemIds) {
        if (
          includedItemIds.has(
            removedItemId,
          )
        ) {
          throw new Error(
            `Job item ${removedItemId} cannot be both included and removed`,
          );
        }
      }

      // =========================================================
      // 6. Get latest quote version
      // =========================================================

      const [latestQuote] = await tx
        .select()
        .from(jobQuotes)
        .where(eq(jobQuotes.jobId, jobId))
        .orderBy(desc(jobQuotes.version))
        .limit(1);

      // ---------------------------------------------------------
      // A FINAL quote is immutable.
      // ---------------------------------------------------------

      if (
        latestQuote?.status === 'final'
      ) {
        throw new Error(
          `Final quote v${latestQuote.version} cannot be revised because it has already been accepted by the customer`,
        );
      }

      const nextVersion =
        (latestQuote?.version ?? 0) + 1;

      // =========================================================
      // 7. Create new JOB quote version
      // =========================================================

      const [jobQuote] = await tx
        .insert(jobQuotes)
        .values({
          jobId,
          version: nextVersion,

          subtotal: '0.00',
          serviceCharge: '0.00',

          discount: discount.toFixed(2),
          tax: tax.toFixed(2),

          totalAmount: '0.00',

          createdByUserId: csUserId,

          status: 'pending',
        })
        .returning();

      // =========================================================
      // 8. Process existing items included in final quote
      // =========================================================

      let subtotal = 0;
      let totalServiceCharge = 0;

      for (const inputItem of items) {
        const existingItem =
          existingItemMap.get(
            inputItem.jobItemId,
          )!;

        const serviceCharge =
          await calculateServiceCharge(
            existingItem,
            tx,
          );

        const quoteResult =
          await insertJobItemQuoteWithLines(
            tx,
            {
              jobQuoteId: jobQuote.id,

              jobItemId:
                existingItem.id,

              components:
                inputItem.components,

              serviceCharge,

              createdByUserId:
                csUserId,
            },
          );

        subtotal +=
          quoteResult.componentsCost;

        totalServiceCharge +=
          quoteResult.serviceChargeAmount;

        const itemComment =
          inputItem.comment?.trim() ||
          comment.trim();

        // -------------------------------------------------------
        // pending_final_quote
        //        ↓
        // awaiting_customer_approval
        // -------------------------------------------------------

        await updateJobItemWithStatusTransition(
          existingItem.id,

          existingItem.currentStatus,

          'awaiting_customer_approval',

          async (transaction) => {
            const [updatedItem] =
              await transaction
                .update(jobItems)
                .set({
                  currentStatus:
                    'awaiting_customer_approval',

                  finalComponentsCost:
                    quoteResult.componentsCost.toFixed(
                      2,
                    ),

                  serviceChargeApplied:
                    quoteResult.serviceChargeAmount.toFixed(
                      2,
                    ),

                  isFinalQuoteApproved: false,

                  onsiteRepairAuthorized:
                    false,

                  updatedAt: new Date(),
                })
                .where(
                  eq(
                    jobItems.id,
                    existingItem.id,
                  ),
                )
                .returning();

            return updatedItem;
          },

          csUserId,

          itemComment,

          tx,
        );
      }

      // =========================================================
      // 9. Process removed items
      // =========================================================

      for (const jobItemId of removedItemIds) {
        const existingItem =
          existingItemMap.get(
            jobItemId,
          )!;

        await updateJobItemWithStatusTransition(
          existingItem.id,

          existingItem.currentStatus,

          'removed_from_quote',

          async (transaction) => {
            const [updatedItem] =
              await transaction
                .update(jobItems)
                .set({
                  currentStatus:
                    'removed_from_quote',

                  finalComponentsCost:
                    null,

                  serviceChargeApplied:
                    null,

                  isFinalQuoteApproved:
                    false,

                  onsiteRepairAuthorized:
                    false,

                  updatedAt: new Date(),
                })
                .where(
                  eq(
                    jobItems.id,
                    existingItem.id,
                  ),
                )
                .returning();

            return updatedItem;
          },

          csUserId,

          `Removed from final quote: ${comment.trim()}`,

          tx,
        );
      }

      // =========================================================
      // 10. Create NEW job items
      // =========================================================

      for (const newItem of addedItems) {
        const [createdItem] =
          await tx
            .insert(jobItems)
            .values({
              jobId,

              deviceCategory:
                newItem.deviceCategory,

              deviceSerialNumber:
                newItem.deviceSerialNumber,

              issueDescription:
                newItem.issueDescription,

              issueCategory:
                newItem.issueCategory,

              repairLocation:
                newItem.repairLocation,

              currentStatus: 'created',

              isApprovedByCS: true,

              isFinalQuoteApproved:
                false,
            })
            .returning();

        // -------------------------------------------------------
        // Calculate service charge
        // -------------------------------------------------------

        const serviceCharge =
          await calculateServiceCharge(
            createdItem,
            tx,
          );

        // -------------------------------------------------------
        // Create item quote linked to JOB quote version
        // -------------------------------------------------------

        const quoteResult =
          await insertJobItemQuoteWithLines(
            tx,
            {
              jobQuoteId:
                jobQuote.id,

              jobItemId:
                createdItem.id,

              components:
                newItem.components,

              serviceCharge,

              createdByUserId:
                csUserId,
            },
          );

        subtotal +=
          quoteResult.componentsCost;

        totalServiceCharge +=
          quoteResult.serviceChargeAmount;

        const itemComment =
          newItem.comment?.trim() ||
          comment.trim();

        // -------------------------------------------------------
        // created
        //    ↓
        // awaiting_customer_approval
        // -------------------------------------------------------

        await updateJobItemWithStatusTransition(
          createdItem.id,

          'created',

          'awaiting_customer_approval',

          async (transaction) => {
            const [updatedItem] =
              await transaction
                .update(jobItems)
                .set({
                  currentStatus:
                    'awaiting_customer_approval',

                  finalComponentsCost:
                    quoteResult.componentsCost.toFixed(
                      2,
                    ),

                  serviceChargeApplied:
                    quoteResult.serviceChargeAmount.toFixed(
                      2,
                    ),

                  isFinalQuoteApproved:
                    false,

                  onsiteRepairAuthorized:
                    false,

                  updatedAt: new Date(),
                })
                .where(
                  eq(
                    jobItems.id,
                    createdItem.id,
                  ),
                )
                .returning();

            return updatedItem;
          },

          csUserId,

          itemComment,

          tx,
        );
      }

      // =========================================================
      // 11. Calculate JOB quote totals
      // =========================================================

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
          discount * 100,
        ) / 100;

      const finalTax =
        Math.round(
          tax * 100,
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

      // =========================================================
      // 12. Update JOB quote totals
      // =========================================================

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

      // =========================================================
      // 13. Job-level audit comment
      // =========================================================

      await tx
        .insert(jobComments)
        .values({
          jobId,
          userId: csUserId,
          comment: comment.trim(),
        });

      // =========================================================
      // IMPORTANT:
      //
      // DO NOT transition the job here.
      //
      // Job remains:
      // pending_final_quote_onsite
      // =========================================================

      return {
        job: {
          id: job.id,

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

