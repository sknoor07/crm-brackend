import { Request, Response } from 'express';
import { asc, countDistinct, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import crypto from 'crypto';

import {
  hashPassword,
} from '../../shared/utils/password.js';

import { db } from '../../config/database.js';

import {
  users,
  customerProfiles,
  jobs,
  jobItems,
  jobComments,
  jobStatusHistory,
  jobItemStatusHistory,
  accountInvitations,
  deviceServiceCharges,
  jobQuotes,
  jobItemQuotes,
  jobItemQuoteLines,
  invoices,
  invoiceItems,
  jobClosures,
  employeeProfiles,
} from '../../db/schema/index.js';

import {


  GetJobWithItemsQuery,
  GetJobWithItemsResponse,
  JobItemSchema,

} from './jobs.validation.js';

import {
  generateJobNumber,
} from '../../shared/utils/jobNumber.js';
import {
  buildQuoteLineValues,
  insertJobItemQuoteWithLines,
  moneyString,
  resolveQuoteComponents,
} from './quote-components.js';
import { CustomerProfile } from '../customer/customer.validation.js';
import { it } from 'zod/locales';

export const getDeviceCategories = async (
  req: Request,
  res: Response,
) => {
  try {
    const categories = await db
      .select({
        value:
          deviceServiceCharges.deviceCategory,
        serviceCharge:
          deviceServiceCharges.chargeAmount,
      })
      .from(deviceServiceCharges)
      .orderBy(
        asc(deviceServiceCharges.deviceCategory),
      );

    return res.status(200).json({
      categories,
    });
  } catch (error) {
    console.error(
      'Fetch device categories error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while fetching device categories',
    });
  }
};
export const getJobWithItems = async (req: Request<{}, {}, GetJobWithItemsQuery>, res: Response<{}, GetJobWithItemsResponse>) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const offset = (page - 1) * limit;

    const searchCondition = search
      ? or(
        ilike(jobs.jobNumber, `%${search}%`),
        ilike(users.email, `%${search}%`),
        ilike(users.phone, `%${search}%`),
        ilike(customerProfiles.firstName, `%${search}%`),
        ilike(customerProfiles.lastName, `%${search}%`)
      ) : undefined;

    const [{ count: total }] = await db.select({ count: countDistinct(jobs.id), })
      .from(jobs)
      .leftJoin(customerProfiles, eq(customerProfiles.userId, jobs.customerId))
      .leftJoin(users, eq(users.id, jobs.customerId))
      .where(searchCondition);




    const jobRows = await db.select({ job: jobs, customerProfile: customerProfiles, user: users })
      .from(jobs)
      .leftJoin(customerProfiles, eq(customerProfiles.userId, jobs.customerId))
      .leftJoin(users, eq(users.id, jobs.customerId))
      .where(searchCondition)
      .orderBy(desc(jobs.updatedAt))
      .limit(limit)
      .offset(offset);


    const jobIds = jobRows.map(row => row.job.id);

    const itemRows = jobIds.length ? await db.select().from(jobItems).where(inArray(jobItems.jobId, jobIds)) : [];


    const itemMap = new Map<string, JobItemSchema[]>;

    for (const item of itemRows) {
      const existing = itemMap.get(item.jobId);
      if (existing) {
        existing.push(item);
      } else {
        itemMap.set(item.jobId, [item]);
      }
    }

    const result = jobRows.map(row => ({
      job: row.job,
      customer: {
        firstName: row.customerProfile?.firstName ?? "",
        lastName: row.customerProfile?.lastName ?? "",
        phone: row.customerProfile?.phone ?? "",
        email: row.user?.email ?? "",
        billingAddress: row.customerProfile?.billingAddress ?? "",
        gstin: row.customerProfile?.gstin ?? "",
      },
      jobItems: itemMap.get(row.job.id) ?? [],
    }));

    const totalPages = Math.ceil(Number(total / limit));
    res.status(200).json({
      message: "job Fetched successfully",
      result,
      pagination: {
        page,
        limit,
        total: Number(total),
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch {
    res.status(500).json({
      message: "Cannot get job and job item details",
      result: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      },
    });
  }
};


export const getJobDetails = async (req: Request, res: Response,) => {
  try {
    const jobNumber = String(req.params.jobNumber);

    // --------------------------------------------------
    // 1. Find the job + customer information
    // --------------------------------------------------

    const [jobRow] = await db
      .select({
        job: jobs,
        customerProfile: customerProfiles,
        customerUser: users,
      })
      .from(jobs)
      .leftJoin(
        customerProfiles,
        eq(customerProfiles.userId, jobs.customerId),
      )
      .leftJoin(
        users,
        eq(users.id, jobs.customerId),
      )
      .where(eq(jobs.jobNumber, jobNumber))
      .limit(1);

    if (!jobRow) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    // --------------------------------------------------
    // 2. Get all job items
    // --------------------------------------------------

    const items = await db
      .select()
      .from(jobItems)
      .where(eq(jobItems.jobId, jobRow.job.id))
      .orderBy(asc(jobItems.createdAt));

    // --------------------------------------------------
    // 3. Get overall job status history
    // --------------------------------------------------

    const statusHistory = await db
      .select({
        id: jobStatusHistory.id,
        previousStatus: jobStatusHistory.previousStatus,
        newStatus: jobStatusHistory.newStatus,
        note: jobStatusHistory.note,
        createdAt: jobStatusHistory.createdAt,
        changedById: jobStatusHistory.changedBy,
        changedByEmail: users.email,
        changedByUserType: users.userType,

        employeeFirstName: employeeProfiles.firstName,
        employeeLastName: employeeProfiles.lastName,

        customerFirstName: customerProfiles.firstName,
        customerLastName: customerProfiles.lastName,
      })
      .from(jobStatusHistory)
      .leftJoin(
        users,
        eq(users.id, jobStatusHistory.changedBy),
      ).leftJoin(
        employeeProfiles,
        eq(employeeProfiles.userId, users.id),
      )
      .leftJoin(
        customerProfiles,
        eq(customerProfiles.userId, users.id),
      )
      .where(
        eq(jobStatusHistory.jobId, jobRow.job.id),
      )
      .orderBy(asc(jobStatusHistory.createdAt));


    const formattedStatusHistory = statusHistory.map((history) => {
      const isEmployee =
        history.changedByUserType === "employee";

      const firstName = isEmployee
        ? history.employeeFirstName
        : history.customerFirstName;

      const lastName = isEmployee
        ? history.employeeLastName
        : history.customerLastName;

      return {
        id: history.id,
        previousStatus: history.previousStatus,
        newStatus: history.newStatus,
        note: history.note,
        createdAt: history.createdAt,

        changedBy: history.changedById
          ? {
            id: history.changedById,
            name: [firstName, lastName]
              .filter(Boolean)
              .join(" ") || null,
            email: history.changedByEmail,
            userType: history.changedByUserType as
              | "employee"
              | "customer"
              | null,
          }
          : null,
      };
    });
    // --------------------------------------------------
    // 4. Get status history for all items
    // --------------------------------------------------

    const itemIds = items.map((item) => item.id);

    const itemHistory =
      itemIds.length > 0
        ? await db
          .select({
            id: jobItemStatusHistory.id,
            jobItemId: jobItemStatusHistory.jobItemId,
            previousStatus:
              jobItemStatusHistory.previousStatus,
            newStatus:
              jobItemStatusHistory.newStatus,
            note: jobItemStatusHistory.note,
            createdAt:
              jobItemStatusHistory.createdAt,
            changedById:
              jobItemStatusHistory.changedBy,
            changedByEmail: users.email,
          })
          .from(jobItemStatusHistory)
          .leftJoin(
            users,
            eq(
              users.id,
              jobItemStatusHistory.changedBy,
            ),
          )
          .where(
            inArray(
              jobItemStatusHistory.jobItemId,
              itemIds,
            ),
          )
          .orderBy(
            asc(jobItemStatusHistory.createdAt),
          )
        : [];

    // --------------------------------------------------
    // 5. Group item history by item ID
    // --------------------------------------------------

    const itemHistoryMap = new Map<
      string,
      typeof itemHistory
    >();

    for (const history of itemHistory) {
      const existing = itemHistoryMap.get(
        history.jobItemId,
      );

      if (existing) {
        existing.push(history);
      } else {
        itemHistoryMap.set(
          history.jobItemId,
          [history],
        );
      }
    }

    const comments = await db
      .select({
        id: jobComments.id,
        jobId: jobComments.jobId,
        jobItemId: jobComments.jobItemId,
        userId: jobComments.userId,
        comment: jobComments.comment,
        createdAt: jobComments.createdAt,

        user: {
          id: users.id,
          email: users.email,
          userType: users.userType,

          employeeFirstName: employeeProfiles.firstName,
          employeeLastName: employeeProfiles.lastName,

          customerFirstName: customerProfiles.firstName,
          customerLastName: customerProfiles.lastName,
        },
      })
      .from(jobComments)
      .leftJoin(users, eq(users.id, jobComments.userId))
      .leftJoin(
        employeeProfiles,
        eq(employeeProfiles.userId, users.id),
      )
      .leftJoin(
        customerProfiles,
        eq(customerProfiles.userId, users.id),
      )
      .where(
        or(
          eq(jobComments.jobId, jobRow.job.id),
          itemIds.length > 0
            ? inArray(jobComments.jobItemId, itemIds)
            : sql`false`,
        ),
      )
      .orderBy(asc(jobComments.createdAt));

    const formattedComments = comments.map((comment) => {
      const isEmployee = comment.user.userType === "employee";

      const firstName = isEmployee
        ? comment.user.employeeFirstName
        : comment.user.customerFirstName;

      const lastName = isEmployee
        ? comment.user.employeeLastName
        : comment.user.customerLastName;

      return {
        id: comment.id,
        jobId: comment.jobId,
        jobItemId: comment.jobItemId,
        userId: comment.userId,
        comment: comment.comment,
        createdAt: comment.createdAt,

        user: {
          id: comment.user.id,
          name: [firstName, lastName].filter(Boolean).join(" "),
          email: comment.user.email,
          userType: comment.user.userType,
        },
      };
    });

    const quotes = await db
      .select()
      .from(jobQuotes)
      .where(eq(jobQuotes.jobId, jobRow.job.id))
      .orderBy(asc(jobQuotes.version));

    const quoteIds = quotes.map(
      (quote) => quote.id,
    );

    const itemQuotes =
      quoteIds.length > 0
        ? await db
          .select()
          .from(jobItemQuotes)
          .where(
            inArray(
              jobItemQuotes.jobQuoteId,
              quoteIds,
            ),
          )
        : [];

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
          .orderBy(
            asc(jobItemQuoteLines.sortOrder),
          )
        : [];

    const quoteLinesMap = new Map<
      string,
      typeof quoteLines
    >();

    for (const line of quoteLines) {
      const existing = quoteLinesMap.get(
        line.quoteId,
      );

      if (existing) {
        existing.push(line);
      } else {
        quoteLinesMap.set(line.quoteId, [line]);
      }
    }


    const itemQuotesMap = new Map<
      string,
      typeof itemQuotes
    >();

    for (const itemQuote of itemQuotes) {
      const existing = itemQuotesMap.get(
        itemQuote.jobQuoteId,
      );

      if (existing) {
        existing.push(itemQuote);
      } else {
        itemQuotesMap.set(
          itemQuote.jobQuoteId,
          [itemQuote],
        );
      }
    }

    const quotesWithItems = quotes.map((quote) => ({
      quote,

      items: (
        itemQuotesMap.get(quote.id) ?? []
      ).map((itemQuote) => ({
        itemQuote,

        lines:
          quoteLinesMap.get(itemQuote.id) ?? [],
      })),
    }));


    ///invoice
    // --------------------------------------------------
    // 7. Get invoice
    // --------------------------------------------------

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.jobId, jobRow.job.id))
      .limit(1);

    const invoiceItemsData = invoice
      ? await db
        .select()
        .from(invoiceItems)
        .where(
          eq(
            invoiceItems.invoiceId,
            invoice.id,
          ),
        )
        .orderBy(
          asc(invoiceItems.sortOrder),
        )
      : [];

    const invoiceWithItems = invoice
      ? {
        invoice,
        items: invoiceItemsData,
      }
      : null;


    // --------------------------------------------------
    // 8. Get job closure
    // --------------------------------------------------

    const [closure] = await db
      .select()
      .from(jobClosures)
      .where(
        eq(jobClosures.jobId, jobRow.job.id),
      )
      .limit(1);

    // --------------------------------------------------
    // 6. Build final response
    // --------------------------------------------------

    const result = {
      job: jobRow.job,

      customer: {
        id: jobRow.customerUser?.id ?? null,
        firstName:
          jobRow.customerProfile?.firstName ?? '',
        lastName:
          jobRow.customerProfile?.lastName ?? '',
        email:
          jobRow.customerUser?.email ?? '',
        phone:
          jobRow.customerUser?.phone ?? '',
        billingAddress:
          jobRow.customerProfile?.billingAddress ?? '',
        gstin:
          jobRow.customerProfile?.gstin ?? '',
      },

      statusHistory:formattedStatusHistory,

      items: items.map((item) => ({
        item,
        statusHistory:
          itemHistoryMap.get(item.id) ?? [],
      })),

      comments: formattedComments,

      quotes: quotesWithItems,

      invoice: invoiceWithItems,

      closure: closure ?? null,
    };

    return res.status(200).json({
      success: true,
      message: 'Job details fetched successfully',
      data: result,
    });
  } catch (error) {
    console.error('getJobDetails error:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to load job details',
    });
  }
};


///////////////////////////////////////done //////////////////////////////////////////////




/////////////////////////////////////pending/////////////////////////////////////////////

// export const createJobByCS = async (
//   req: Request<{}, {}, CreateJobInput>,
//   res: Response,
// ) => {
//   try {
//     const {
//       customerEmail,
//       customerPhone,
//       customerFirstName,
//       customerLastName,
//       deviceCategory,
//       deviceSerialNumber,
//       issueDescription,
//       estimatedComponentsCost,
//       estimatedComponents,
//       billingAddress,
//       comment,
//     } = req.body;

//     const changedBy = req.user?.userId;

//     if (!changedBy) {
//       return res.status(401).json({
//         error: 'Authenticated user not found',
//       });
//     }

//     // --------------------------------------------------
//     // 1. Verify device category exists
//     // --------------------------------------------------

//     const [configuredCategory] = await db
//       .select({
//         deviceCategory:
//           deviceServiceCharges.deviceCategory,
//         chargeAmount:
//           deviceServiceCharges.chargeAmount,
//       })
//       .from(deviceServiceCharges)
//       .where(
//         eq(
//           deviceServiceCharges.deviceCategory,
//           deviceCategory,
//         ),
//       )
//       .limit(1);

//     if (!configuredCategory) {
//       return res.status(400).json({
//         error: `Invalid device category: ${deviceCategory}`,
//       });
//     }

//     // --------------------------------------------------
//     // 2. Generate customer invitation token
//     // --------------------------------------------------

//     const invitationToken =
//       crypto.randomBytes(32).toString('hex');

//     const invitationHash =
//       crypto
//         .createHash('sha256')
//         .update(invitationToken)
//         .digest('hex');

//     // --------------------------------------------------
//     // 3. Create Job + Job Item atomically
//     // --------------------------------------------------

//     const result = await db.transaction(
//       async (tx) => {
//         // ----------------------------------------------
//         // Find existing customer
//         // ----------------------------------------------

//         const [existingCustomer] =
//           await tx
//             .select({
//               id: users.id,
//               email: users.email,
//             })
//             .from(users)
//             .where(
//               or(
//                 eq(users.email, customerEmail),
//                 eq(users.phone, customerPhone),
//               ),
//             )
//             .limit(1);

//         let customerId: string;
//         let shouldInvite = false;

//         // ----------------------------------------------
//         // Existing customer
//         // ----------------------------------------------

//         if (existingCustomer) {
//           customerId = existingCustomer.id;

//           await tx
//             .update(users)
//             .set({
//               email: customerEmail,
//               phone: customerPhone,
//             })
//             .where(
//               eq(
//                 users.id,
//                 customerId,
//               ),
//             );
//         }

//         // ----------------------------------------------
//         // New customer
//         // ----------------------------------------------

//         else {
//           const hashedPassword = crypto.randomBytes(
//             32,
//           ).toString('hex');

//           const passwordHash =
//             await import(
//               '../../shared/utils/password.js'
//             ).then(({ hashPassword }) =>
//               hashPassword(hashedPassword),
//             );

//           const [newCustomer] =
//             await tx
//               .insert(users)
//               .values({
//                 email: customerEmail,
//                 passwordHash,
//                 phone: customerPhone,
//                 userType: 'customer',
//                 mustChangePassword: true,
//               })
//               .returning({
//                 id: users.id,
//               });

//           customerId = newCustomer.id;
//           shouldInvite = true;
//         }

//         // ----------------------------------------------
//         // Customer profile
//         // ----------------------------------------------

//         await tx
//           .insert(customerProfiles)
//           .values({
//             userId: customerId,
//             firstName: customerFirstName,
//             lastName: customerLastName,
//             phone: customerPhone,
//             billingAddress,
//           })
//           .onConflictDoUpdate({
//             target: customerProfiles.userId,
//             set: {
//               firstName: customerFirstName,
//               lastName: customerLastName,
//               phone: customerPhone,
//               billingAddress,
//             },
//           });

//         // ----------------------------------------------
//         // Create Job
//         // ----------------------------------------------

//         const jobId = crypto.randomUUID();

//         const jobNumber =
//           generateJobNumber();

//         const [createdJob] =
//           await tx
//             .insert(jobs)
//             .values({
//               id: jobId,
//               jobNumber,
//               customerId,

//               currentStatus: 'in_progress',
//             })
//             .returning();

//         // ----------------------------------------------
//         // Create Job Item
//         // ----------------------------------------------

//         const estimateComponents = resolveQuoteComponents(
//           estimatedComponents,
//           estimatedComponentsCost,
//         );

//         if (!estimateComponents) {
//           throw new Error(
//             'Estimated components are required',
//           );
//         }

//         const estimatedCost = moneyString(
//           buildQuoteLineValues('estimate', estimateComponents)
//             .componentsCost,
//         );

//         const [createdJobItem] =
//           await tx
//             .insert(jobItems)
//             .values({
//               jobId,

//               deviceCategory,

//               deviceSerialNumber:
//                 deviceSerialNumber || null,

//               issueDescription,

//               estimatedComponentsCost: estimatedCost,

//               currentStatus:
//                 'pending_cs_verification',
//             })
//             .returning();

//         await insertJobItemQuoteWithLines(tx, {
//           jobItemId: createdJobItem.id,
//           version: 1,
//           components: estimateComponents,
//           serviceCharge: configuredCategory.chargeAmount,
//           createdByUserId: changedBy,
//           status: 'estimate',
//         });

//         // ----------------------------------------------
//         // Job status history
//         // ----------------------------------------------

//         await tx
//           .insert(jobStatusHistory)
//           .values({
//             jobId,

//             previousStatus: null,

//             newStatus:
//               'in_progress',

//             changedBy,

//             note: comment,
//           });

//         // ----------------------------------------------
//         // Job item status history
//         // ----------------------------------------------

//         await tx
//           .insert(jobItemStatusHistory)
//           .values({
//             jobItemId:
//               createdJobItem.id,

//             previousStatus: null,

//             newStatus:
//               'pending_cs_verification',

//             changedBy,

//             note: comment,
//           });

//         // ----------------------------------------------
//         // Initial job comment
//         // ----------------------------------------------

//         await tx
//           .insert(jobComments)
//           .values({
//             jobId,

//             userId: changedBy,

//             comment,
//           });

//         // ----------------------------------------------
//         // Customer invitation
//         // ----------------------------------------------

//         if (shouldInvite) {
//           const expiresAt =
//             new Date(
//               Date.now() +
//               24 * 60 * 60 * 1000,
//             );

//           await tx
//             .insert(accountInvitations)
//             .values({
//               userId: customerId,
//               tokenHash: invitationHash,
//               expiresAt,
//             });
//         }

//         return {
//           createdJob,
//           createdJobItem,
//           shouldInvite,
//         };
//       },
//     );

//     // --------------------------------------------------
//     // Response
//     // --------------------------------------------------

//     return res.status(201).json({
//       message:
//         'Job created successfully by Customer Service',

//       job: result.createdJob,

//       item: result.createdJobItem,

//       ...(result.shouldInvite
//         ? {
//           invitationToken,
//         }
//         : {}),
//     });
//   } catch (error) {
//     console.error(
//       'Job Creation Error:',
//       error,
//     );

//     return res.status(500).json({
//       error:
//         'Internal server error while creating job',
//     });
//   }
// };

