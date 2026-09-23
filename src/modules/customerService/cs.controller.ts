import { Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { and, asc, desc, eq, exists, ilike, inArray, notExists, or, sql } from 'drizzle-orm';

import { db } from '../../config/database.js';

import { jobs, jobItems, jobComments, jobStatusHistory, jobClosures, jobItemQuotes, deviceServiceCharges, jobItemQuoteLines, JobItemStatus, jobItemStatusHistory, JobSummaryStatus, users, customerProfiles, jobQuotes, invoices, } from '../../db/schema/index.js';

import {
  GenerateFinalQuoteInput, CloseJobInput, CSApproveJobAndJobItemInput,
  QuoteComponentInput,
} from './cs.validation.js';

import { updateJobItemWithStatusTransition } from '../jobstatusandtransitions/item-status-history.js';
import { buildQuoteLineValues, insertJobItemQuoteWithLines, moneyString, resolveQuoteComponents } from '../jobs/quote-components.js';
import { calculateServiceCharge, processCSJobApproval } from './service/approveJobsByCS.js';
import { allowedJobTransitions, canTransitionJob } from '../jobstatusandtransitions/status-history.js';
import { transitionJob } from '../jobstatusandtransitions/transition-job.js';
import { createInvoiceForJob, generateAndStoreInvoicePdf } from '../invoice/invoice.service.js';



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

interface CustomerParams extends ParamsDictionary {
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


export const getAllCustomers = async (
  req: Request,
  res: Response,
) => {
  try {

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
      .groupBy(
        users.id,
        customerProfiles.firstName,
        customerProfiles.lastName,
        users.email,
        customerProfiles.phone,
      ).orderBy(desc(users.createdAt));

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
        sql`${jobItems.currentStatus} NOT IN ('delivered', 'repair_rejected','cancelled','removed_from_quote')`,
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

      .where(and(or(eq(jobs.currentStatus, 'delivered',), eq(jobs.currentStatus, 'repair_completed')), exists(hasItems), notExists(hasNonFinalItems)));

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
    // OR
    // removed_from_quote
    // OR
    // cancelled
    // --------------------------------------------------

    const nonFinalItems = items.filter(
      (item) =>
        item.currentStatus !== 'delivered' &&
        item.currentStatus !== 'repair_rejected' &&
        item.currentStatus !== 'removed_from_quote' &&
        item.currentStatus !== 'cancelled',
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
                eq(jobs.id, jobId),
                or(
                  eq(
                    jobs.currentStatus,
                    'delivered',
                  ),
                  eq(
                    jobs.currentStatus,
                    'repair_completed',
                  ),
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
              `Job closed successfully by CS Person with Id ${userId}.`,

            comment:
              closureReason,

            existingTx:
              tx,

            updateJob:
              (tx: DbTransaction) =>
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
        // --------------------------------------------------

        const [closure] =
          await tx
            .insert(jobClosures)
            .values({
              jobId,

              closedByUserId:
                userId,

              closingRemarks:
                closureReason,

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


    // ==================================================
    // INVOICE GENERATION
    //
    // IMPORTANT:
    // This happens AFTER the close transaction commits.
    // ==================================================

    let invoice = null;

    try {

      // --------------------------------------------------
      // 1. Create invoice snapshot
      //
      // This reads the final quote and creates:
      //
      // invoices
      // invoice_items
      // --------------------------------------------------

      invoice =
        await createInvoiceForJob(
          jobId,
        );


      // --------------------------------------------------
      // 2. Generate PDF
      // 3. Upload PDF to Neon Object Storage
      // 4. Update invoice record
      // --------------------------------------------------

      invoice =
        await generateAndStoreInvoicePdf(
          invoice.id,
        );

    } catch (invoiceError) {

      console.error(
        'Invoice generation failed after job closure:',
        invoiceError,
      );

      // --------------------------------------------------
      // IMPORTANT:
      //
      // Do NOT fail the job closure because invoice
      // generation failed.
      //
      // The job is already closed.
      // The invoice can be retried later.
      // --------------------------------------------------

      try {

        await db
          .update(invoices)
          .set({
            status: 'failed',
            updatedAt: new Date(),
          })
          .where(
            eq(
              invoices.jobId,
              jobId,
            ),
          );

      } catch (invoiceStatusError) {

        console.error(
          'Failed to update invoice status:',
          invoiceStatusError,
        );
      }
    }


    // --------------------------------------------------
    // SUCCESS
    // --------------------------------------------------

    return res.status(200).json({
      status: 'success',

      message:
        'Job closed successfully.',

      ...result,

      invoice: invoice
        ? {
          id: invoice.id,
          invoiceNumber:
            invoice.invoiceNumber,
          status:
            invoice.status,
          pdfFileName:
            invoice.pdfFileName,
        }
        : null,
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
interface JobParams extends ParamsDictionary {
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

// export const getPendingFinalQuotes = async (
//   req: Request,
//   res: Response,
// ) => {
//   try {
//     // --------------------------------------------------
//     // 1. Get jobs waiting for final quote
//     // --------------------------------------------------

//     const jobsPendingQuote = await db
//       .select({
//         job: jobs,
//         customer: customerProfiles,
//       })
//       .from(jobs)
//       .leftJoin(
//         customerProfiles,
//         eq(customerProfiles.userId, jobs.customerId),
//       )
//       .where(
//         eq(
//           jobs.currentStatus,
//           'pending_final_quote',
//         ),
//       )
//       .orderBy(desc(jobs.updatedAt));

//     if (jobsPendingQuote.length === 0) {
//       return res.status(200).json({
//         status: 'success',
//         count: 0,
//         jobs: [],
//       });
//     }

//     const jobIds = jobsPendingQuote.map(
//       ({ job }) => job.id,
//     );

//     // --------------------------------------------------
//     // 2. Get ONLY items pending final quote
//     // --------------------------------------------------

//     const pendingQuoteItems = await db
//       .select()
//       .from(jobItems)
//       .where(
//         and(
//           inArray(jobItems.jobId, jobIds),
//           eq(
//             jobItems.currentStatus,
//             'pending_final_quote',
//           ),
//         ),
//       )
//       .orderBy(desc(jobItems.updatedAt));

//     const itemIds = pendingQuoteItems.map(
//       (item) => item.id,
//     );

//     // --------------------------------------------------
//     // 3. Get latest comments for jobs/items
//     // --------------------------------------------------

//     const comments =
//       jobIds.length > 0 || itemIds.length > 0
//         ? await db
//           .select({
//             id: jobComments.id,
//             jobId: jobComments.jobId,
//             jobItemId: jobComments.jobItemId,
//             userId: jobComments.userId,
//             comment: jobComments.comment,
//             createdAt: jobComments.createdAt,
//           })
//           .from(jobComments)
//           .where(
//             or(
//               inArray(
//                 jobComments.jobId,
//                 jobIds,
//               ),
//               itemIds.length > 0
//                 ? inArray(
//                   jobComments.jobItemId,
//                   itemIds,
//                 )
//                 : undefined,
//             ),
//           )
//           .orderBy(
//             desc(jobComments.createdAt),
//             desc(jobComments.id),
//           )
//         : [];

//     // --------------------------------------------------
//     // 4. Keep latest comment per job/item
//     // --------------------------------------------------

//     const latestJobComments = new Map<
//       string,
//       (typeof comments)[number]
//     >();

//     const latestItemComments = new Map<
//       string,
//       (typeof comments)[number]
//     >();

//     for (const comment of comments) {
//       if (
//         comment.jobId &&
//         !latestJobComments.has(comment.jobId)
//       ) {
//         latestJobComments.set(
//           comment.jobId,
//           comment,
//         );
//       }

//       if (
//         comment.jobItemId &&
//         !latestItemComments.has(
//           comment.jobItemId,
//         )
//       ) {
//         latestItemComments.set(
//           comment.jobItemId,
//           comment,
//         );
//       }
//     }

//     // --------------------------------------------------
//     // 5. Helper
//     // --------------------------------------------------

//     const toLatestComment = (
//       comment:
//         | (typeof comments)[number]
//         | undefined,
//     ) =>
//       comment
//         ? {
//           id: comment.id,
//           userId: comment.userId,
//           comment: comment.comment,
//           createdAt: comment.createdAt,
//         }
//         : null;

//     // --------------------------------------------------
//     // 6. Group items by job
//     // --------------------------------------------------

//     const itemsByJobId = new Map<
//       string,
//       typeof pendingQuoteItems
//     >();

//     for (const item of pendingQuoteItems) {
//       const existing =
//         itemsByJobId.get(item.jobId);

//       if (existing) {
//         existing.push(item);
//       } else {
//         itemsByJobId.set(
//           item.jobId,
//           [item],
//         );
//       }
//     }

//     // --------------------------------------------------
//     // 7. Build response
//     // --------------------------------------------------

//     const result = jobsPendingQuote.map(
//       ({ job, customer }) => {
//         const items =
//           itemsByJobId.get(job.id) ?? [];

//         return {
//           job: {
//             ...job,
//             latestComment:
//               toLatestComment(
//                 latestJobComments.get(job.id),
//               ),
//           },

//           customer,

//           items: items.map((item) => ({
//             ...item,

//             latestComment:
//               toLatestComment(
//                 latestItemComments.get(
//                   item.id,
//                 ),
//               ),
//           })),
//         };
//       },
//     );

//     // --------------------------------------------------
//     // 8. Response
//     // --------------------------------------------------

//     return res.status(200).json({
//       status: 'success',
//       count: result.length,
//       jobs: result,
//     });
//   } catch (error) {
//     console.error(
//       'Error fetching jobs pending final quote:',
//       error,
//     );

//     return res.status(500).json({
//       status: 'error',
//       message:
//         'Failed to fetch jobs pending final quote',
//     });
//   }
// };

export const getPendingFinalQuotes = async (
  req: Request,
  res: Response,
) => {
  try {
    // --------------------------------------------------
    // 1. Get jobs whose status is pending_final_quote
    // --------------------------------------------------

    const jobsPendingQuote = await db
      .select({
        job: jobs,
        customer: customerProfiles,
      })
      .from(jobs)
      .leftJoin(
        customerProfiles,
        eq(
          customerProfiles.userId,
          jobs.customerId,
        ),
      )
      .where(
        eq(
          jobs.currentStatus,
          "pending_final_quote",
        ),
      )
      .orderBy(desc(jobs.updatedAt));

    if (jobsPendingQuote.length === 0) {
      return res.status(200).json({
        status: "success",
        count: 0,
        jobs: [],
      });
    }

    const jobIds = jobsPendingQuote.map(
      ({ job }) => job.id,
    );

    // --------------------------------------------------
    // 2. Get ONLY items that CS can quote
    //
    // pending_final_quote
    // repair_rejected
    // cancelled
    // --------------------------------------------------

    const pendingQuoteItems = await db
      .select()
      .from(jobItems)
      .where(
        and(
          inArray(jobItems.jobId, jobIds),
          or(
            eq(
              jobItems.currentStatus,
              "pending_final_quote",
            ),
            eq(
              jobItems.currentStatus,
              "repair_rejected",
            ),
            eq(
              jobItems.currentStatus,
              "cancelled",
            ),
          ),
        ),
      )
      .orderBy(desc(jobItems.updatedAt));

    // --------------------------------------------------
    // 3. Only jobs having at least one
    //    pending_final_quote item should appear
    // --------------------------------------------------

    const jobsWithPendingItems = new Set(
      pendingQuoteItems
        .filter(
          (item) =>
            item.currentStatus ===
            "pending_final_quote",
        )
        .map((item) => item.jobId),
    );

    const filteredJobs =
      jobsPendingQuote.filter(
        ({ job }) =>
          jobsWithPendingItems.has(job.id),
      );

    if (filteredJobs.length === 0) {
      return res.status(200).json({
        status: "success",
        count: 0,
        jobs: [],
      });
    }

    // --------------------------------------------------
    // 4. Get comments
    //    - latest job-level comment
    //    - latest item-level comment
    // --------------------------------------------------

    const filteredJobIds = filteredJobs.map(
      ({ job }) => job.id,
    );

    const itemIds = pendingQuoteItems.map(
      (item) => item.id,
    );

    const comments =
      itemIds.length > 0
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
                filteredJobIds,
              ),
              inArray(
                jobComments.jobItemId,
                itemIds,
              ),
            ),
          )
          .orderBy(
            desc(jobComments.createdAt),
            desc(jobComments.id),
          )
        : [];

    // --------------------------------------------------
    // 5. Latest job comment
    // --------------------------------------------------

    const latestJobComments = new Map<
      string,
      (typeof comments)[number]
    >();

    // --------------------------------------------------
    // 6. Latest item comment
    // --------------------------------------------------

    const latestItemComments = new Map<
      string,
      (typeof comments)[number]
    >();

    for (const comment of comments) {
      if (
        comment.jobId &&
        !latestJobComments.has(
          comment.jobId,
        )
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
    // 7. Helper for latest comment
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
    // 8. Group items by job
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
    // 9. Build response
    // --------------------------------------------------

    const result = filteredJobs.map(
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
    // 10. Response
    // --------------------------------------------------

    return res.status(200).json({
      status: "success",
      count: result.length,
      jobs: result,
    });
  } catch (error) {
    console.error(
      "Error fetching jobs pending final quote:",
      error,
    );

    return res.status(500).json({
      status: "error",
      message:
        "Failed to fetch jobs pending final quote",
    });
  }
};


export const getQuoteForAJob = async (
  req: Request,
  res: Response,
) => {
  try {
    const jobId = req.params.jobId;

    if (typeof jobId !== "string") {
      return res.status(400).json({
        status: "error",
        message: "Invalid job ID",
      });
    }

    // --------------------------------------------------
    // 1. Validate jobId
    // --------------------------------------------------

    if (!jobId) {
      return res.status(400).json({
        status: "error",
        message: "Job ID is required",
      });
    }

    // --------------------------------------------------
    // 2. Get all job items
    // --------------------------------------------------

    const items = await db
      .select()
      .from(jobItems)
      .where(eq(jobItems.jobId, jobId));

    // --------------------------------------------------
    // 3. Get latest quote
    //    Highest version = latest
    // --------------------------------------------------

    const [latestQuote] = await db
      .select()
      .from(jobQuotes)
      .where(eq(jobQuotes.jobId, jobId))
      .orderBy(desc(jobQuotes.version))
      .limit(1);

    // --------------------------------------------------
    // 4. Get comments
    //
    //    We need:
    //    - latest job-level comment
    //    - latest comment for every job item
    // --------------------------------------------------

    const itemIds = items.map(
      (item) => item.id,
    );

    const comments =
      await db
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
          itemIds.length > 0
            ? or(
              eq(
                jobComments.jobId,
                jobId,
              ),
              inArray(
                jobComments.jobItemId,
                itemIds,
              ),
            )
            : eq(
              jobComments.jobId,
              jobId,
            ),
        )
        .orderBy(
          desc(jobComments.createdAt),
          desc(jobComments.id),
        );

    // --------------------------------------------------
    // 5. Latest job-level comment
    // --------------------------------------------------

    const latestJobComment =
      comments.find(
        (comment) =>
          comment.jobId === jobId &&
          comment.jobItemId === null,
      ) ?? null;

    // --------------------------------------------------
    // 6. Latest item-level comment
    // --------------------------------------------------

    const latestItemComments = new Map<
      string,
      (typeof comments)[number]
    >();

    for (const comment of comments) {
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
    // 7. If there is NO quote yet
    // --------------------------------------------------

    if (!latestQuote) {
      return res.status(200).json({
        status: "success",

        quote: null,

        latestComment:
          latestJobComment
            ? {
              id: latestJobComment.id,
              userId:
                latestJobComment.userId,
              comment:
                latestJobComment.comment,
              createdAt:
                latestJobComment.createdAt,
            }
            : null,

        items: items.map((item) => ({
          jobItemId: item.id,

          quote: null,

          lines: [],

          latestComment:
            latestItemComments.has(item.id)
              ? {
                id:
                  latestItemComments.get(
                    item.id,
                  )!.id,
                userId:
                  latestItemComments.get(
                    item.id,
                  )!.userId,
                comment:
                  latestItemComments.get(
                    item.id,
                  )!.comment,
                createdAt:
                  latestItemComments.get(
                    item.id,
                  )!.createdAt,
              }
              : null,
        })),
      });
    }

    // --------------------------------------------------
    // 8. Get item quotes for latest quote
    // --------------------------------------------------

    const itemQuotes = await db
      .select()
      .from(jobItemQuotes)
      .where(
        eq(
          jobItemQuotes.jobQuoteId,
          latestQuote.id,
        ),
      );

    // --------------------------------------------------
    // 9. Get quote lines
    // --------------------------------------------------

    const itemQuoteIds = itemQuotes.map(
      (itemQuote) => itemQuote.id,
    );

    const quoteLines =
      itemQuoteIds.length > 0
        ? await db
          .select()
          .from(jobItemQuoteLines)
          .where(
            inArray(
              jobItemQuoteLines.quoteId,
              itemQuoteIds,
            ),
          )
        : [];

    // --------------------------------------------------
    // 10. Group quote lines by item quote
    // --------------------------------------------------

    const linesByQuoteId = new Map<
      string,
      typeof quoteLines
    >();

    for (const line of quoteLines) {
      const existing =
        linesByQuoteId.get(line.quoteId);

      if (existing) {
        existing.push(line);
      } else {
        linesByQuoteId.set(
          line.quoteId,
          [line],
        );
      }
    }

    // --------------------------------------------------
    // 11. Map item quote by jobItemId
    // --------------------------------------------------

    const itemQuoteByItemId = new Map(
      itemQuotes.map((itemQuote) => [
        itemQuote.jobItemId,
        itemQuote,
      ]),
    );

    // --------------------------------------------------
    // 12. Helper
    // --------------------------------------------------

    const toLatestComment = (
      comment:
        | (typeof comments)[number]
        | null
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
    // 13. Build response
    // --------------------------------------------------

    const result = {
      quote: latestQuote,

      latestComment:
        toLatestComment(
          latestJobComment,
        ),

      items: items.map((item) => {
        const itemQuote =
          itemQuoteByItemId.get(item.id);

        return {
          jobItemId: item.id,

          quote: itemQuote
            ? {
              ...itemQuote,
            }
            : null,

          lines: itemQuote
            ? linesByQuoteId.get(
              itemQuote.id,
            ) ?? []
            : [],

          latestComment:
            toLatestComment(
              latestItemComments.get(
                item.id,
              ),
            ),
        };
      }),
    };

    return res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error(
      "Error fetching latest quote:",
      error,
    );

    return res.status(500).json({
      status: "error",
      message: "Failed to fetch latest quote",
    });
  }
};

// export const generateFinalQuote = async (
//   req: Request<{}, {}, GenerateFinalQuoteInput>,
//   res: Response,
// ) => {
//   try {
//     const csUserId = req.user?.userId;

//     if (!csUserId) {
//       return res.status(401).json({
//         message: 'Unauthorized',
//       });
//     }

//     const {
//       jobId,
//       items,
//       comment,
//       discount = 0,
//       gst = 0,
//     } = req.body;

//     const jobComment =
//       comment?.trim() ||
//       'Final quote generated';

//     const result = await db.transaction(async (tx) => {
//       // --------------------------------------------------
//       // 1. Get job
//       // --------------------------------------------------

//       const [job] = await tx
//         .select()
//         .from(jobs)
//         .where(eq(jobs.id, jobId))
//         .limit(1);

//       if (!job) {
//         throw new Error('Job not found');
//       }

//       // --------------------------------------------------
//       // 2. Job must be pending final quote
//       // --------------------------------------------------

//       if (
//         job.currentStatus !==
//         'pending_final_quote'
//       ) {
//         throw new Error(
//           `Final quote can only be generated when job status is pending_final_quote. Current status: ${job.currentStatus}`,
//         );
//       }

//       // --------------------------------------------------
//       // 3. Get ALL job items
//       // --------------------------------------------------

//       const existingItems = await tx
//         .select()
//         .from(jobItems)
//         .where(
//           eq(jobItems.jobId, jobId),
//         );

//       if (existingItems.length === 0) {
//         throw new Error(
//           'Cannot generate final quote because the job has no items',
//         );
//       }

//       // --------------------------------------------------
//       // 4. Every job item must be pending_final_quote
//       // --------------------------------------------------

//       const notReadyItems =
//         existingItems.filter(
//           (item) =>
//             item.currentStatus !==
//             'pending_final_quote',
//         );

//       if (notReadyItems.length > 0) {
//         throw new Error(
//           'Final quote cannot be generated because all job items must be in pending_final_quote status. ' +
//           `Items not ready: ${notReadyItems
//             .map(
//               (item) =>
//                 `${item.id} (${item.currentStatus})`,
//             )
//             .join(', ')}`,
//         );
//       }

//       // --------------------------------------------------
//       // 5. Validate submitted items
//       //
//       // CS can only update components of existing items.
//       // --------------------------------------------------

//       if (items.length !== existingItems.length) {
//         throw new Error(
//           'All job items must be included in the final quote',
//         );
//       }

//       const existingItemMap = new Map(
//         existingItems.map((item) => [
//           item.id,
//           item,
//         ]),
//       );

//       const submittedItemIds = new Set<string>();

//       for (const inputItem of items) {
//         // ----------------------------------------------
//         // Item must belong to this job
//         // ----------------------------------------------

//         const existingItem =
//           existingItemMap.get(
//             inputItem.jobItemId,
//           );

//         if (!existingItem) {
//           throw new Error(
//             `Job item ${inputItem.jobItemId} does not belong to this job`,
//           );
//         }

//         // ----------------------------------------------
//         // Item must still be pending final quote
//         // ----------------------------------------------

//         if (
//           existingItem.currentStatus !==
//           'pending_final_quote'
//         ) {
//           throw new Error(
//             `Job item ${inputItem.jobItemId} is not in pending_final_quote status`,
//           );
//         }

//         // ----------------------------------------------
//         // Prevent duplicate item entries
//         // ----------------------------------------------

//         if (
//           submittedItemIds.has(
//             inputItem.jobItemId,
//           )
//         ) {
//           throw new Error(
//             `Job item ${inputItem.jobItemId} was submitted more than once`,
//           );
//         }

//         submittedItemIds.add(
//           inputItem.jobItemId,
//         );
//       }

//       // --------------------------------------------------
//       // 6. Make sure no existing item was omitted
//       // --------------------------------------------------

//       for (const existingItem of existingItems) {
//         if (
//           !submittedItemIds.has(
//             existingItem.id,
//           )
//         ) {
//           throw new Error(
//             `Job item ${existingItem.id} is missing from the final quote`,
//           );
//         }
//       }

//       // --------------------------------------------------
//       // 7. Get latest quote version
//       // --------------------------------------------------

//       const [latestQuote] = await tx
//         .select()
//         .from(jobQuotes)
//         .where(
//           eq(
//             jobQuotes.jobId,
//             jobId,
//           ),
//         )
//         .orderBy(
//           desc(jobQuotes.version),
//         )
//         .limit(1);

//       const nextVersion =
//         (latestQuote?.version ?? 0) + 1;

//       // --------------------------------------------------
//       // 8. Create job quote
//       // --------------------------------------------------

//       const [jobQuote] = await tx
//         .insert(jobQuotes)
//         .values({
//           jobId,
//           version: nextVersion,

//           subtotal: '0.00',
//           serviceCharge: '0.00',

//           discount: Number(discount).toFixed(2),
//           tax: Number(gst).toFixed(2),

//           totalAmount: '0.00',

//           createdByUserId: csUserId,

//           status: 'pending',
//         })
//         .returning();

//       let subtotal = 0;
//       let totalServiceCharge = 0;

//       // --------------------------------------------------
//       // 9. Create quote for every existing job item
//       // --------------------------------------------------

//       for (const inputItem of items) {
//         const existingItem =
//           existingItemMap.get(
//             inputItem.jobItemId,
//           )!;

//         // ----------------------------------------------
//         // Calculate service charge from existing item
//         //
//         // No job item fields are modified here.
//         // ----------------------------------------------

//         const serviceCharge =
//           await calculateServiceCharge(
//             existingItem,
//             tx,
//           );

//         // ----------------------------------------------
//         // Create quote item + components
//         //
//         // Components come from CS request.
//         // This allows CS to:
//         // - add components
//         // - remove components
//         // - edit quantity
//         // - edit unit price
//         // ----------------------------------------------

//         const quoteResult =
//           await insertJobItemQuoteWithLines(
//             tx,
//             {
//               jobQuoteId:
//                 jobQuote.id,

//               jobItemId:
//                 existingItem.id,

//               components:
//                 inputItem.components ?? [],

//               serviceCharge,

//               createdByUserId:
//                 csUserId,
//             },
//           );

//         subtotal +=
//           quoteResult.componentsCost;

//         totalServiceCharge +=
//           quoteResult.serviceChargeAmount;

//         // ----------------------------------------------
//         // Move item to customer approval
//         // ----------------------------------------------

//         await updateJobItemWithStatusTransition(
//           existingItem.id,
//           'pending_final_quote',
//           'awaiting_customer_approval',
//           async (transaction) => {
//             const [updatedItem] = await transaction
//               .update(jobItems)
//               .set({
//                 currentStatus:
//                   'awaiting_customer_approval',

//                 finalComponentsCost:
//                   quoteResult.componentsCost.toFixed(2),

//                 serviceChargeApplied:
//                   quoteResult.serviceChargeAmount.toFixed(2),

//                 isFinalQuoteApproved: false,

//                 onsiteRepairAuthorized:
//                   existingItem.onsiteRepairAuthorized,

//                 inlabRepairAuthorized:
//                   existingItem.inlabRepairAuthorized,

//                 updatedAt: new Date(),
//               })
//               .where(
//                 eq(jobItems.id, existingItem.id),
//               )
//               .returning();

//             return updatedItem;
//           },
//           csUserId,
//           'Final quote generated for item.',
//           tx,
//         );
//       }

//       // --------------------------------------------------
//       // 10. Calculate quote totals
//       // --------------------------------------------------

//       const finalSubtotal =
//         Math.round(
//           subtotal * 100,
//         ) / 100;

//       const finalServiceCharge =
//         Math.round(
//           totalServiceCharge * 100,
//         ) / 100;

//       const finalDiscount =
//         Math.round(
//           Number(discount) * 100,
//         ) / 100;

//       const finalTax =
//         Math.round(
//           Number(gst) * 100,
//         ) / 100;

//       const totalAmount =
//         Math.round(
//           (
//             finalSubtotal +
//             finalServiceCharge -
//             finalDiscount +
//             finalTax
//           ) * 100,
//         ) / 100;

//       // --------------------------------------------------
//       // 11. Update quote totals
//       // --------------------------------------------------

//       const [updatedQuote] =
//         await tx
//           .update(jobQuotes)
//           .set({
//             subtotal:
//               finalSubtotal.toFixed(2),

//             serviceCharge:
//               finalServiceCharge.toFixed(2),

//             discount:
//               finalDiscount.toFixed(2),

//             tax:
//               finalTax.toFixed(2),

//             totalAmount:
//               totalAmount.toFixed(2),
//           })
//           .where(
//             eq(
//               jobQuotes.id,
//               jobQuote.id,
//             ),
//           )
//           .returning();

//       // --------------------------------------------------
//       // 12. Job-level audit comment
//       //
//       // IMPORTANT:
//       // Job status remains pending_final_quote.
//       // --------------------------------------------------

//       await tx
//         .insert(jobComments)
//         .values({
//           jobId,

//           jobItemId: null,

//           userId: csUserId,

//           comment: jobComment,
//         });

//       // --------------------------------------------------
//       // 13. Return
//       // --------------------------------------------------

//       return {
//         job: {
//           id: job.id,

//           // Job DOES NOT change status
//           currentStatus:
//             job.currentStatus,
//         },

//         quote: updatedQuote,

//         totals: {
//           subtotal:
//             finalSubtotal,

//           serviceCharge:
//             finalServiceCharge,

//           discount:
//             finalDiscount,

//           tax:
//             finalTax,

//           totalAmount,
//         },
//       };
//     });

//     return res.status(200).json({
//       message:
//         'Final quote generated successfully',

//       data: result,
//     });
//   } catch (error) {
//     console.error(
//       'generateFinalQuote error:',
//       error,
//     );

//     return res.status(400).json({
//       message:
//         error instanceof Error
//           ? error.message
//           : 'Failed to generate final quote',
//     });
//   }
// };


















//done












// export const getQuoteForAJob = async (req: Request, res: Response)=>{
//   const jobId = req.params.id as string;
//   if (!jobId) {
//     res.status(400).json({ message: "Job Id Not found" })
//     const job = await db.select().from(jobs).where(eq(jobs.id, jobId))
//   }
//   try {
//     if (!jobId) {
//       res.status(400).json({ message: "Job Id Not found" })
//     }

//     const job = await db.select().from(jobs).where(eq(jobs.id, jobId))
//     if (!job) {
//       res.status(500).json({ message: "No job Found" })
//     }
//     const result = await db.select().from(jobQuotes).leftJoin(jobItemQuotes, eq(jobQuotes.id, jobItemQuotes.jobQuoteId)).leftJoin(jobItemQuoteLines, eq(jobItemQuotes.id, jobItemQuoteLines.quoteId)).where(eq( jobQuotes.jobId,jobId));
//     res.status(200).json({ message: "quote fecth successfully" });

//   }
//   catch (err) {
//     res.status(500).json({ message: "problem in fecthing quote" });
//   }
// }

export const generateFinalQuote = async (
  req: Request<{}, {}, GenerateFinalQuoteInput>,
  res: Response,
) => {
  try {
    const csUserId = req.user?.userId;

    if (!csUserId) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized",
      });
    }


    const {
      jobId,
      items,
      comment,
      discount = 0,
      cgst = null,
      sgst = null,
      igst = null,
      gstType = "none",
    } = req.body;

    if (gstType === "none" && (cgst != null || sgst != null || igst != null)) {
      throw new Error("GST values must be omitted for none GST.");
    }

    if (gstType === "intra_state" && (cgst == null || sgst == null || igst != null)) {
      throw new Error("Intra-state GST requires CGST and SGST only.");
    }

    if (gstType === "inter_state" && (igst == null || cgst != null || sgst != null)) {
      throw new Error("Inter-state GST requires IGST only.");
    }

    const result = await db.transaction(async (tx) => {
      // ---------------------------------------------------------
      // 1. Get job
      // ---------------------------------------------------------
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job) {
        throw new Error("Job not found");
      }

      // ---------------------------------------------------------
      // 2. Job must be pending_final_quote
      // ---------------------------------------------------------
      if (job.currentStatus !== "pending_final_quote") {
        throw new Error(
          `Final quote can only be generated when job status is pending_final_quote. Current status: ${job.currentStatus}`,
        );
      }

      // ---------------------------------------------------------
      // 3. Get ALL job items
      // ---------------------------------------------------------
      const existingItems = await tx
        .select()
        .from(jobItems)
        .where(eq(jobItems.jobId, jobId));

      if (existingItems.length === 0) {
        throw new Error(
          "Cannot generate final quote because the job has no items",
        );
      }

      // ---------------------------------------------------------
      // 4. Allowed item statuses
      // ---------------------------------------------------------
      const allowedStatuses = new Set([
        "pending_final_quote",
        "repair_rejected",
        "cancelled",
      ]);

      const invalidItems = existingItems.filter(
        (item) => !allowedStatuses.has(item.currentStatus),
      );

      if (invalidItems.length > 0) {
        throw new Error(
          "Final quote cannot be generated because some job items are not ready. " +
          `Invalid items: ${invalidItems
            .map((item) => `${item.id} (${item.currentStatus})`)
            .join(", ")}`,
        );
      }

      // ---------------------------------------------------------
      // 5. Every existing item must be submitted
      // ---------------------------------------------------------
      if (items.length !== existingItems.length) {
        throw new Error(
          "All existing job items must be included in the final quote",
        );
      }

      // ---------------------------------------------------------
      // 6. Create lookup map
      // ---------------------------------------------------------
      const existingItemMap = new Map(
        existingItems.map((item) => [item.id, item]),
      );

      const submittedItemIds = new Set<string>();

      // ---------------------------------------------------------
      // 7. Validate submitted items
      // ---------------------------------------------------------
      for (const inputItem of items) {
        const existingItem = existingItemMap.get(inputItem.jobItemId);

        if (!existingItem) {
          throw new Error(
            `Job item ${inputItem.jobItemId} does not belong to this job`,
          );
        }

        if (submittedItemIds.has(inputItem.jobItemId)) {
          throw new Error(
            `Job item ${inputItem.jobItemId} was submitted more than once`,
          );
        }

        submittedItemIds.add(inputItem.jobItemId);
      }

      // ---------------------------------------------------------
      // 8. Check for missing items
      // ---------------------------------------------------------
      for (const existingItem of existingItems) {
        if (!submittedItemIds.has(existingItem.id)) {
          throw new Error(
            `Job item ${existingItem.id} is missing from the final quote`,
          );
        }
      }

      // ---------------------------------------------------------
      // 9. Get latest quote version
      // ---------------------------------------------------------
      const [latestQuote] = await tx
        .select()
        .from(jobQuotes)
        .where(eq(jobQuotes.jobId, jobId))
        .orderBy(desc(jobQuotes.version))
        .limit(1);

      const nextVersion = (latestQuote?.version ?? 0) + 1;

      // ---------------------------------------------------------
      // 10. Create new job quote
      // ---------------------------------------------------------
      const [jobQuote] = await tx
        .insert(jobQuotes)
        .values({
          jobId,
          version: nextVersion,
          subtotal: "0.00",
          serviceCharge: "0.00",
          discount: Number(discount).toFixed(2),
          cgst:
            cgst == null
              ? null
              : Number(cgst).toFixed(2),

          sgst:
            sgst == null
              ? null
              : Number(sgst).toFixed(2),
          igst:
            igst == null
              ? null
              : Number(igst).toFixed(2),
          gstType,
          totalAmount: "0.00",
          createdByUserId: csUserId,
          status: "pending",
        })
        .returning();

      let subtotal = 0;
      let totalServiceCharge = 0;

      // ---------------------------------------------------------
      // 11. Process EVERY item
      // ---------------------------------------------------------
      for (const inputItem of items) {
        const existingItem = existingItemMap.get(inputItem.jobItemId)!;

        const isPendingFinalQuote =
          existingItem.currentStatus === "pending_final_quote";

        const isRejectedOrCancelled =
          existingItem.currentStatus === "repair_rejected" ||
          existingItem.currentStatus === "cancelled";

        // -------------------------------------------------------
        // 12. Determine components
        //
        // undefined -> preserve previous quote components
        // []        -> remove all components
        // [...]      -> replace components
        // -------------------------------------------------------
        let components = inputItem.components;

        if (components === undefined) {
          const [previousItemQuote] = await tx
            .select()
            .from(jobItemQuotes)
            .where(eq(jobItemQuotes.jobItemId, existingItem.id))
            .orderBy(desc(jobItemQuotes.createdAt))
            .limit(1);

          if (previousItemQuote) {
            const previousLines = await tx
              .select()
              .from(jobItemQuoteLines)
              .where(
                eq(
                  jobItemQuoteLines.quoteId,
                  previousItemQuote.id,
                ),
              )
              .orderBy(asc(jobItemQuoteLines.sortOrder));

            components = previousLines.map((line) => ({
              name: line.name,
              quantity: line.quantity,
              unitPrice: Number(line.unitPrice),
            }));
          } else {
            components = [];
          }
        }

        // -------------------------------------------------------
        // 13. Determine service charge
        // -------------------------------------------------------
        let serviceCharge = 0;

        if (isPendingFinalQuote) {
          // Calculate based on the existing item's repair location
          serviceCharge = await calculateServiceCharge(
            existingItem,
            tx,
          );
        } else if (isRejectedOrCancelled) {
          // For rejected/cancelled items, frontend may provide
          // an inspection/service charge.
          serviceCharge = inputItem.serviceCharge ?? 0;
        }

        // -------------------------------------------------------
        // 14. Create item quote + quote lines
        // -------------------------------------------------------
        const quoteResult = await insertJobItemQuoteWithLines(
          tx,
          {
            jobQuoteId: jobQuote.id,
            jobItemId: existingItem.id,
            components: components ?? [],
            serviceCharge,
            createdByUserId: csUserId,
          },
        );

        // -------------------------------------------------------
        // 15. Add item totals
        // -------------------------------------------------------
        subtotal += quoteResult.componentsCost;
        totalServiceCharge += quoteResult.serviceChargeAmount;

        // -------------------------------------------------------
        // 16. Update item
        // -------------------------------------------------------
        if (isPendingFinalQuote) {
          await updateJobItemWithStatusTransition(
            existingItem.id,
            "pending_final_quote",
            "awaiting_customer_approval",
            async (transaction) => {
              const [updatedItem] = await transaction
                .update(jobItems)
                .set({
                  currentStatus: "awaiting_customer_approval",

                  finalComponentsCost:
                    quoteResult.componentsCost.toFixed(2),

                  serviceChargeApplied:
                    quoteResult.serviceChargeAmount.toFixed(2),

                  isFinalQuoteApproved: false,

                  updatedAt: new Date(),
                })
                .where(eq(jobItems.id, existingItem.id))
                .returning();

              return updatedItem;
            },
            csUserId,

            // Default item transition comment
            "Final quote generated and sent for customer approval.",

            tx,
          );
        } else {
          // -----------------------------------------------------
          // Rejected / cancelled item
          //
          // Do NOT insert jobComments here because your current
          // comment_target_check constraint rejects:
          //
          // jobId != null AND jobItemId != null
          //
          // The item quote is still created normally.
          // -----------------------------------------------------
          await tx
            .update(jobItems)
            .set({
              finalComponentsCost:
                quoteResult.componentsCost.toFixed(2),

              serviceChargeApplied:
                quoteResult.serviceChargeAmount.toFixed(2),

              updatedAt: new Date(),
            })
            .where(eq(jobItems.id, existingItem.id));
        }
      }

      // ---------------------------------------------------------
      // 17. Calculate final totals
      // ---------------------------------------------------------
      const finalSubtotal =
        Math.round(subtotal * 100) / 100;

      const finalServiceCharge =
        Math.round(totalServiceCharge * 100) / 100;

      const finalDiscount =
        Math.round(Number(discount) * 100) / 100;

      const finalCgst =
        cgst == null
          ? 0
          : Math.round(Number(cgst) * 100) / 100;

      const finalSgst =
        sgst == null
          ? 0
          : Math.round(Number(sgst) * 100) / 100;

      const finalIgst =
        igst == null
          ? 0
          : Math.round(Number(igst) * 100) / 100;

      const totalAmount =
        Math.round(
          (
            finalSubtotal +
            finalServiceCharge -
            finalDiscount +
            finalCgst +
            finalSgst +
            finalIgst
          ) * 100,
        ) / 100;

      // ---------------------------------------------------------
      // 18. Update quote totals
      // ---------------------------------------------------------
      const [updatedQuote] = await tx
        .update(jobQuotes)
        .set({
          subtotal: finalSubtotal.toFixed(2),

          serviceCharge:
            finalServiceCharge.toFixed(2),

          discount:
            finalDiscount.toFixed(2),

          cgst:
            cgst == null
              ? null
              : finalCgst.toFixed(2),

          sgst:
            sgst == null
              ? null
              : finalSgst.toFixed(2),

          igst:
            igst == null
              ? null
              : finalIgst.toFixed(2),

          gstType,

          totalAmount:
            totalAmount.toFixed(2),
        })
        .where(eq(jobQuotes.id, jobQuote.id))
        .returning();

      // ---------------------------------------------------------
      // 19. Job-level comment
      //
      // jobItemId MUST remain null for a job-level comment.
      // ---------------------------------------------------------
      await tx
        .insert(jobComments)
        .values({
          jobId,
          jobItemId: null,
          userId: csUserId,
          comment:
            comment?.trim() ||
            "Final quote generated and sent for customer approval.",
        });

      // ---------------------------------------------------------
      // 20. Return result
      // ---------------------------------------------------------
      return {
        job: {
          id: job.id,
          currentStatus: job.currentStatus,
        },

        quote: updatedQuote,

        totals: {
          subtotal: finalSubtotal,
          serviceCharge: finalServiceCharge,
          discount: finalDiscount,
          cgst: cgst == null ? null : finalCgst,
          sgst: sgst == null ? null : finalSgst,
          igst: igst == null ? null : finalIgst,
          gstType,
          totalAmount,
        },
      };
    });

    // -----------------------------------------------------------
    // Success response
    // -----------------------------------------------------------
    return res.status(200).json({
      status: "success",
      message: "Final quote generated successfully",
      data: result,
    });
  } catch (error) {
    console.error("generateFinalQuote error:", error);

    return res.status(400).json({
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Failed to generate final quote",
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

