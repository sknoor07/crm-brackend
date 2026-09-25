import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { customerProfiles, jobItems, jobs, users, } from '../../db/schema/index.js';
const staffRoles = new Set([
    'admin',
    'customer_service',
]);
const canAccessAllJobs = (req) => (req.user?.roles ?? []).some((role) => staffRoles.has(role));
const ownershipFilter = (req) => {
    if (canAccessAllJobs(req))
        return undefined;
    return req.user?.userId
        ? eq(jobs.customerId, req.user.userId)
        : undefined;
};
// export const getJobById = async (req: Request, res: Response) => {
//   try {
//     const jobId = String(req.params.jobId);
//     const access = ownershipFilter(req);
//     const where = access
//       ? and(eq(jobs.id, jobId), access)
//       : eq(jobs.id, jobId);
//     const [job] = await db
//       .select({
//         id: jobs.id,
//         jobNumber: jobs.jobNumber,
//         customerId: jobs.customerId,
//         jobStatus: jobs.currentStatus,
//         customerFirstName: customerProfiles.firstName,
//         customerLastName: customerProfiles.lastName,
//         customerEmail: users.email,
//         customerPhone: users.phone,
//         createdAt: jobs.createdAt,
//         updatedAt: jobs.updatedAt,
//       })
//       .from(jobs)
//       .innerJoin(users, eq(users.id, jobs.customerId))
//       .leftJoin(
//         customerProfiles,
//         eq(customerProfiles.userId, jobs.customerId),
//       )
//       .where(where)
//       .limit(1);
//     if (!job) {
//       return res.status(404).json({
//         success: false,
//         error: 'Job not found',
//       });
//     }
//     const items = await db
//       .select()
//       .from(jobItems)
//       .where(eq(jobItems.jobId, job.id))
//       .orderBy(desc(jobItems.createdAt));
//     const itemIds = items.map((item) => item.id);
//     const quotes = itemIds.length
//       ? await db
//           .select()
//           .from(jobItemQuotes)
//           .where(inArray(jobItemQuotes.jobItemId, itemIds))
//           .orderBy(desc(jobItemQuotes.version))
//       : [];
//     const quoteIds = quotes.map((quote) => quote.id);
//     const lines = quoteIds.length
//       ? await db
//           .select()
//           .from(jobItemQuoteLines)
//           .where(inArray(jobItemQuoteLines.quoteId, quoteIds))
//           .orderBy(asc(jobItemQuoteLines.sortOrder))
//       : [];
//     const linesByQuoteId = new Map<string, typeof lines>();
//     for (const line of lines) {
//       const existing = linesByQuoteId.get(line.quoteId) ?? [];
//       existing.push(line);
//       linesByQuoteId.set(line.quoteId, existing);
//     }
//     const itemsWithQuotes = items.map((item) => ({
//       ...item,
//       quotes: quotes
//         .filter((quote) => quote.jobItemId === item.id)
//         .map((quote) => ({
//           ...quote,
//           components: linesByQuoteId.get(quote.id) ?? [],
//         })),
//     }));
//     // #region agent log
//     fetch('http://127.0.0.1:7382/ingest/119b0d15-a375-4f9f-95a5-b87c6fbcf288',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9a98d3'},body:JSON.stringify({sessionId:'9a98d3',runId:'pre-fix',hypothesisId:'H2',location:'read.controller.ts:getJobById',message:'Loaded job quotes with lines',data:{jobId:job.id,itemCount:items.length,quoteCount:quotes.length,lineCount:lines.length},timestamp:Date.now()})}).catch(()=>{});
//     // #endregion
//     return res.status(200).json({
//       success: true,
//       data: {
//         id: job.id,
//         jobNumber: job.jobNumber,
//         currentStatus: items[0]?.currentStatus ?? job.jobStatus,
//         jobStatus: job.jobStatus,
//         customer: {
//           id: job.customerId,
//           name: [job.customerFirstName, job.customerLastName]
//             .filter(Boolean)
//             .join(' ') || job.customerEmail,
//           email: job.customerEmail,
//           phone: job.customerPhone,
//         },
//         items: itemsWithQuotes,
//         createdAt: job.createdAt,
//         updatedAt: job.updatedAt,
//       },
//     });
//   } catch (error) {
//     console.error('getJobById error:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to load job',
//     });
//   }
// };
// export const getJobDetailedStatusHistory = async (req: Request,res: Response,) => {
//   try {
//     const jobId = String(req.params.jobId);
//     const [job] = await db
//       .select({ id: jobs.id })
//       .from(jobs)
//       .where(eq(jobs.id,jobId))
//       .limit(1);
//     if (!job) {
//       return res.status(404).json({
//         success: false,
//         error: 'Job not found',
//       });
//     }
//     const history = await db
//       .select({
//         id: jobStatusHistory.id,
//         previousStatus: jobStatusHistory.previousStatus,
//         newStatus: jobStatusHistory.newStatus,
//         note: jobStatusHistory.note,
//         createdAt: jobStatusHistory.createdAt,
//         changedById: jobStatusHistory.changedBy,
//         changedByEmail: users.email,
//       })
//       .from(jobStatusHistory)
//       .leftJoin(users, eq(users.id, jobStatusHistory.changedBy))
//       .where(eq(jobStatusHistory.jobId, jobId))
//       .orderBy(desc(jobStatusHistory.createdAt));
//     return res.status(200).json({
//       success: true,
//       job: history,
//     });
//   } catch (error) {
//     console.error('getJobStatusHistory error:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to load job status history',
//     });
//   }
// };
// export const getJobItemDetailedStatusHistory = async (req: Request,res: Response,) => {
//   try {
//     const jobItemId = String(req.params.jobId);
//     const [job] = await db
//       .select({ id: jobItems.id })
//       .from(jobItems)
//       .where(eq(jobItems.id,jobItemId))
//       .limit(1);
//     if (!job) {
//       return res.status(404).json({
//         success: false,
//         error: 'Job not found',
//       });
//     }
//     const history = await db
//       .select({
//         id: jobItemStatusHistory.id,
//         previousStatus: jobItemStatusHistory.previousStatus,
//         newStatus: jobItemStatusHistory.newStatus,
//         note: jobItemStatusHistory.note,
//         createdAt: jobItemStatusHistory.createdAt,
//         changedById: jobItemStatusHistory.changedBy,
//         changedByEmail: users.email,
//       })
//       .from(jobItemStatusHistory)
//       .leftJoin(users, eq(users.id, jobItemStatusHistory.changedBy))
//       .where(eq(jobItemStatusHistory.jobItemId, jobItemId))
//       .orderBy(desc(jobItemStatusHistory.createdAt));
//     return res.status(200).json({
//       success: true,
//       jobItems: history,
//     });
//   } catch (error) {
//     console.error('getJobItemStatusHistory error:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to load jobItem status history',
//     });
//   }
// };
export const listJobs = async (req, res) => {
    try {
        const pageValue = Number(req.query.page ?? 1);
        const limitValue = Number(req.query.limit ?? 20);
        const page = Number.isFinite(pageValue)
            ? Math.max(Math.trunc(pageValue), 1)
            : 1;
        const limit = Number.isFinite(limitValue)
            ? Math.min(Math.max(Math.trunc(limitValue), 1), 100)
            : 20;
        const offset = (page - 1) * limit;
        const search = String(req.query.search ?? '').trim();
        const status = String(req.query.status ?? '').trim();
        const filters = [];
        const ownership = ownershipFilter(req);
        if (ownership)
            filters.push(ownership);
        if (search)
            filters.push(ilike(jobs.jobNumber, `%${search}%`));
        if (status) {
            filters.push(eq(jobItems.currentStatus, status));
        }
        const where = filters.length ? and(...filters) : undefined;
        const rows = await db
            .select({
            id: jobs.id,
            jobNumber: jobs.jobNumber,
            customerId: jobs.customerId,
            customerFirstName: customerProfiles.firstName,
            customerLastName: customerProfiles.lastName,
            customerEmail: users.email,
            deviceCategory: jobItems.deviceCategory,
            currentStatus: jobItems.currentStatus,
            createdAt: jobs.createdAt,
            updatedAt: jobs.updatedAt,
        })
            .from(jobs)
            .innerJoin(jobItems, eq(jobItems.jobId, jobs.id))
            .innerJoin(users, eq(users.id, jobs.customerId))
            .leftJoin(customerProfiles, eq(customerProfiles.userId, jobs.customerId))
            .where(where)
            .orderBy(desc(jobs.updatedAt))
            .limit(limit)
            .offset(offset);
        const [{ total }] = await db
            .select({ total: sql `count(*)::int` })
            .from(jobs)
            .innerJoin(jobItems, eq(jobItems.jobId, jobs.id))
            .where(where);
        return res.status(200).json({
            success: true,
            data: {
                items: rows.map((row) => ({
                    ...row,
                    customerName: [row.customerFirstName, row.customerLastName]
                        .filter(Boolean)
                        .join(' ') || row.customerEmail,
                })),
                pagination: {
                    page,
                    limit,
                    total: Number(total),
                    totalPages: Math.ceil(Number(total) / limit),
                },
            },
        });
    }
    catch (error) {
        console.error('listJobs error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to load jobs',
        });
    }
};
