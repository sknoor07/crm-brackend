import { Request, Response } from 'express';
import {
  and,
  asc,
  desc,
  eq,
} from 'drizzle-orm';

import { db } from '../../config/database.js';

import {
  jobs,
  jobItems,
  jobComments,
  jobItemStatusHistory,
  customerProfiles,
} from '../../db/schema/index.js';

import {
  updateJobItemWithStatusTransition,
} from '../jobstatusandtransitions/item-status-history.js';

import type {
  JobItemStatus,
  JobSummaryStatus,
} from '../../db/schema/job-status.js';
import { DeliverItemInput, StartDeliveryInput } from './transportPerson.validation.js';
import { allowedJobTransitions } from '../jobstatusandtransitions/status-history.js';
import { date } from 'zod';


type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];


/**
 * Returns the authenticated user's ID.
 */
const getUserId = (req: Request): string => {
  if (!req.user?.userId || !req.user.roles?.includes('transport_team_person')) {
    throw new Error('Authenticated user ID is missing');
  }

  return req.user.userId;
};


/**
 * Verify that the logged-in Transport Person
 * is assigned to the job.
 *
 * Admins can access any job.
 */
const isAuthorizedForJob = (
  job: typeof jobs.$inferSelect,
  userId: string,
  roles: string[] = [],
): boolean => {
  if (roles.includes('admin')) {
    return true;
  }

  return job.assignedTransportTeamPersonId === userId;
};


/**
 * Find a job item and make sure it belongs
 * to the expected job.
 */
const getJobItem = async (
  jobItemId: string,
) => {
  const [item] = await db
    .select()
    .from(jobItems)
    .where(eq(jobItems.id, jobItemId))
    .limit(1);

  return item;
};


/**
 * GET ASSIGNED JOBS
 *
 * Shows jobs assigned to this Transport Person.
 */
export const getAssignedJobs = async (req: Request, res: Response,) => {
  try {
    const transportPersonId = getUserId(req);

    const rawResults = await db.select({
      job: jobs,
      jobItem: jobItems,
      customerProfile: customerProfiles
    })
      .from(jobs)
      .innerJoin(jobItems, eq(jobItems.jobId, jobs.id))
      // Use leftJoin so jobs still load even if a customer profile is missing
      .leftJoin(customerProfiles, eq(jobs.customerId, customerProfiles.userId))
      .where(
        and(
          eq(jobs.assignedTransportTeamPersonId, transportPersonId,),
          eq(jobs.currentStatus, 'in_progress'),
          //eq(jobItems.currentStatus, 'approved_for_transport'),
        )

      )
      .orderBy(desc(jobs.createdAt));
    // const assignedJobs = await db
    //   .select()
    //   .from(jobs)
    //   .where(
    //     eq(
    //       jobs.assignedTransportTeamPersonId,
    //       transportPersonId,
    //     ),
    //   )
    //   .orderBy(desc(jobs.createdAt));

    const jobsMap = new Map();

    for (const row of rawResults) {
      const jobId = row.job.id;

      if (!jobsMap.has(jobId)) {
        // Initialize the job the first time we see this ID
        jobsMap.set(jobId, {
          job: row.job,
          customer: row.customerProfile, // Mount customer directly onto the job wrapper
          jobItems: []
        });
      }

      // Add the current device/item to the jobItems array
      if (row.jobItem) {
        jobsMap.get(jobId).jobItems.push(row.jobItem);
      }
    }

    // Convert the Map back to a clean array
    const groupedJobs = Array.from(jobsMap.values());

    return res.status(200).json({
      jobs: groupedJobs,
    });
  } catch (error) {
    console.error(
      'Get assigned transport jobs error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};

/**
transport person starts the transport visit for a job.
*/

export const startTransportJobVisit = async (req: Request, res: Response,) => {
  try {
    const transportPersonId = getUserId(req);
    const { jobId, comment } = req.body;

    return await db.transaction(async (tx) => {
      // 1. Fetch and validate the job
      const [job] = await tx
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      if (!isAuthorizedForJob(job, transportPersonId, req.user?.roles)) {
        return res.status(403).json({ error: 'You are not assigned to this job.' });
      }

      if (job.currentStatus !== 'in_progress') {
        return res.status(400).json({
          error: `Cannot start transport visit for job with status '${job.currentStatus}'.`,
        });
      }

      // 2. Update the parent job
      const [updatedJob] = await tx
        .update(jobs)
        .set({ updatedAt: new Date() })
        .where(eq(jobs.id, jobId))
        .returning();

      // 3. Fetch the specific items we need to transition
      const itemsToUpdate = await tx
        .select()
        .from(jobItems)
        .where(
          and(
            eq(jobItems.jobId, jobId),
            eq(jobItems.currentStatus, 'approved_for_transport')
          )
        );

      // 4. Update each item using your status transition tracker
      for (const item of itemsToUpdate) {
        // IMPORTANT: Change 'transport_inspection' to match your allowed transitions map if needed
        const newStatus: JobItemStatus = 'transport_visit_in_progress';

        await updateJobItemWithStatusTransition(
          item.id,
          item.currentStatus as JobItemStatus,
          newStatus,
          async (dbTx) => {
            const [updated] = await dbTx
              .update(jobItems)
              .set({ currentStatus: newStatus, updatedAt: new Date() })
              .where(eq(jobItems.id, item.id))
              .returning();
            return updated;
          },
          transportPersonId,
          comment || 'Started transport visit',
          tx // <-- Pass the parent transaction here
        );
      }

      return res.status(200).json({
        message: 'Customer visit has been started.',
        job: updatedJob
      });

    });
  } catch (error: any) {
    console.error('Start transport job error:', error);

    // Catch the specific transition error to send a helpful response
    if (error.message.includes('Invalid job item status transition')) {
      return res.status(400).json({ error: error.message });
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
  * START ONSITE REPAIR fo an Item
 */
export const startOnsiteRepair = async (req: Request, res: Response,) => {
  try {
    const transportPersonId = getUserId(req);

    const { jobItemId, comment, } = req.body;

    const item = await getJobItem(jobItemId);

    if (!item) {
      return res.status(404).json({ error: 'Job item not found', });
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, item.jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({ error: 'Parent job not found', });
    }

    if (!isAuthorizedForJob(job, transportPersonId, req.user?.roles,)) {
      return res.status(403).json({ error: 'You are not assigned to this job.', });
    }

    if (item.repairLocation !== 'customer_site') {
      return res.status(400).json({ error: 'This item is not configured for onsite repair.', });
    }

    if (item.currentStatus !== 'transport_visit_in_progress') {
      return res.status(400).json({ error: `Repair cannot start from status '${item.currentStatus}'. Customer approval is required first.`, });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'repair_in_progress',
        async (tx) => {
          const [result] = await tx
            .update(jobItems)
            .set({ currentStatus: 'repair_in_progress', updatedAt: new Date(), })
            .where(eq(jobItems.id, jobItemId))
            .returning();

          await tx.insert(jobComments).values({ jobItemId, userId: transportPersonId, comment, });

          return result;
        },
        transportPersonId,
        comment,
      );

    return res.status(200).json({
      message: 'Onsite repair has started.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Start onsite repair error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};

/**
  * FINISH ONSITE REPAIR fo an Item
 */
export const finishOnsiteRepair = async (req: Request, res: Response,) => {
  try {
    const transportPersonId = getUserId(req);

    const { jobItemId, comment, } = req.body;

    const item = await getJobItem(jobItemId);

    if (!item) {
      return res.status(404).json({ error: 'Job item not found', });
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, item.jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({ error: 'Parent job not found', });
    }

    if (!isAuthorizedForJob(job, transportPersonId, req.user?.roles,)) {
      return res.status(403).json({ error: 'You are not assigned to this job.', });
    }

    if (item.repairLocation !== 'customer_site') {
      return res.status(400).json({ error: 'This item is not configured for onsite repair.', });
    }

    if (item.currentStatus !== 'repair_in_progress' && item.currentStatus === 'repair_rejected') {
      return res.status(400).json({ error: `Repair cannot start from status '${item.currentStatus}'. Customer approval is required first.`, });
    }
    if (item.currentStatus === 'repair_finished') {
      return res.status(400).json({ error: `Repair Already Completed '${item.currentStatus}'.`, });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'repair_finished',
        async (tx) => {
          const [result] = await tx
            .update(jobItems)
            .set({ currentStatus: 'repair_finished', updatedAt: new Date(), })
            .where(eq(jobItems.id, jobItemId))
            .returning();

          await tx.insert(jobComments).values({ jobItemId, userId: transportPersonId, comment, });

          return result;
        },
        transportPersonId,
        comment,
      );

    return res.status(200).json({
      message: `Onsite repair finished for item ${item.deviceCategory}.`,
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Finish onsite repair error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};

/**
 complete all job order and send for final quote
 */
export const completeOnsiteRepair = async (req: Request, res: Response,) => {
  try {
    const transportPersonId = getUserId(req);

    const { jobId, comment, } = req.body;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) {
      return res.status(404).json({ error: 'Job not found or already finished.', });
    }

    if (!isAuthorizedForJob(job, transportPersonId, req.user?.roles,)) {
      return res.status(403).json({ error: 'You are not assigned to this job.', });
    }
    const newStatus: JobSummaryStatus = 'pending_final_quote_onsite';
    const transitionKey = job.currentStatus;
    if (!allowedJobTransitions[transitionKey]?.includes(newStatus)) {
      return res.status(403).json({ error: `Invalid job item status transition: ${transitionKey} -> ${newStatus}`, });
    }


    const jobItem = await db.select().from(jobItems).where(eq(jobItems.jobId, jobId));

    jobItem.forEach(async (item) => {
      if (item.currentStatus !== 'repair_finished' && item.currentStatus !== 'repair_rejected') {
        return res.status(400).json({ error: `Cannot Finish Onsite Repair Please finish for item ${item.deviceCategory} with status '${item.currentStatus}'.`, });
      }
    });

    const updatedJob = await db.update(jobs).set({ currentStatus: newStatus, updatedAt: new Date(), }).where(eq(jobs.id, jobId)).returning();
    const insertedComment = await db.insert(jobComments).values({ jobId, userId: transportPersonId, comment, }).returning();

    return res.status(200).json({
      message:
        'Onsite repair completed. CS team has been notified for final Quote Creation.',
      item: updatedJob,
      comment: insertedComment,
    });
  } catch (error) {
    console.error('Complete onsite repair error:', error);

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};

/**
 * GET ITEMS FOR INSPECTION
 */
export const sendJobforInspectionAtLab = async (req: Request, res: Response,) => {
  try {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) {
      return res.status(404).json({ error: 'Job not found', });
    }

    const items = await db.select().from(jobItems).where(eq(jobItems.jobId, jobId)).orderBy(asc(jobItems.createdAt));

    const hasPendingLabReceipt = items.some(
      (item) => item.currentStatus === 'pending_lab_receipt'
    );

    if (!hasPendingLabReceipt) {
      throw new Error('Please mark atleast one item to send to lab');
    }

    await db.update(jobs).set({currentStatus:"going_to_lab",updatedAt: new Date()})
    return res.status(200).json({job,items,});
  } catch (error) {
    console.error('send job to lab error :',error,);

    return res.status(500).json({error: 'Internal server error',});
  }
};


export const rejectJobItem = async (
  req: Request,
  res: Response,
) => {
  try {
    const transportPersonId = getUserId(req);

    const {
      jobItemId,
      comment,
    } = req.body;

    const item = await getJobItem(jobItemId);

    if (!item) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, item.jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({
        error: 'Parent job not found',
      });
    }

    if (
      !isAuthorizedForJob(
        job,
        transportPersonId,
        req.user?.roles,
      )
    ) {
      return res.status(403).json({
        error: 'You are not assigned to this job.',
      });
    }

    if (
      item.currentStatus !==
      'transport_visit_in_progress'
    ) {
      return res.status(400).json({
        error:
          `Cannot reject item from status '${item.currentStatus}'.`,
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'repair_rejected',
        async (tx) => {
          const [result] = await tx
            .update(jobItems)
            .set({
              currentStatus: 'repair_rejected',
              updatedAt: new Date(),
            })
            .where(eq(jobItems.id, jobItemId))
            .returning();

          await tx.insert(jobComments).values({
            jobItemId,
            userId: transportPersonId,
            comment,
          });

          return result;
        },
        transportPersonId,
        comment,
      );

    return res.status(200).json({
      message:
        'Item has been rejected.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Reject job item error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/**
 * SEND ITEM TO LAB
 *
 * transport_inspection
 *          ↓
 * pending_lab_receipt
 */
export const sendItemToLab = async (req: Request,res: Response,) => {
  try {
    const transportPersonId = getUserId(req);

    const {jobItemId,comment,} = req.body;

    const item = await getJobItem(jobItemId);

    if (!item) {
      return res.status(404).json({error: 'Job item not found',});
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, item.jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({error: 'Parent job not found',});
    }

    if (!isAuthorizedForJob(job,transportPersonId,req.user?.roles,)) {
      return res.status(403).json({error: 'You are not assigned to this job.',});
    }

    if (item.currentStatus !=='transport_visit_in_progress') {
      return res.status(400).json({
        error:
          `Cannot send item to lab from status '${item.currentStatus}'.`,
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'pending_lab_receipt',
        async (tx) => {
          const [result] = await tx
            .update(jobItems)
            .set({
              repairLocation: 'lab',
              currentStatus:
                'pending_lab_receipt',
              updatedAt: new Date(),
            })
            .where(eq(jobItems.id, jobItemId))
            .returning();

          await tx.insert(jobComments).values({
            jobItemId,
            userId: transportPersonId,
            comment,
          });

          return result;
        },
        transportPersonId,
        comment,
      );

    return res.status(200).json({
      message:
        'Item has been sent to the lab.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Send item to lab error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/**
 * INSPECT ITEM
 *
 * approved_for_transport
 *          ↓
 * transport_inspection
 */
export const inspectJobItem = async (req: Request,res: Response) => {
  try {
    const transportPersonId = getUserId(req);

    const {
      jobItemId,
      comment,
    } = req.body;

    const item = await getJobItem(jobItemId);

    if (!item) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, item.jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({
        error: 'Parent job not found',
      });
    }

    if (
      !isAuthorizedForJob(
        job,
        transportPersonId,
        req.user?.roles,
      )
    ) {
      return res.status(403).json({
        error: 'You are not assigned to this job.',
      });
    }

    if (
      item.currentStatus !==
      'approved_for_transport'
    ) {
      return res.status(400).json({
        error:
          `Cannot inspect item from status '${item.currentStatus}'.`,
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'transport_inspection',
        async (tx) => {
          const [result] = await tx
            .update(jobItems)
            .set({
              currentStatus:
                'transport_inspection',
              updatedAt: new Date(),
            })
            .where(eq(jobItems.id, jobItemId))
            .returning();

          await tx.insert(jobComments).values({
            jobItemId,
            userId: transportPersonId,
            comment,
          });

          return result;
        },
        transportPersonId,
        comment,
      );

    return res.status(200).json({
      message:
        'Item inspection has started.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Inspect job item error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};





/**
 * REQUEST FINAL QUOTE FOR ONSITE REPAIR
 *
 * This is the important case we discussed.
 *
 * Components may be empty.
 *
 * The service charge is still calculated by CS.
 *
 * transport_inspection
 *          ↓
 * pending_final_quote_onsite
 */
export const requestFinalQuote = async (
  req: Request,
  res: Response,
) => {
  try {
    const transportPersonId = getUserId(req);

    const {
      jobItemId,
      requestedComponents,
      additionalNotes,
      comment,
    } = req.body;

    const item = await getJobItem(jobItemId);

    if (!item) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, item.jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({
        error: 'Parent job not found',
      });
    }

    if (
      !isAuthorizedForJob(
        job,
        transportPersonId,
        req.user?.roles,
      )
    ) {
      return res.status(403).json({
        error: 'You are not assigned to this job.',
      });
    }

    if (
      item.currentStatus !==
      'transport_inspection'
    ) {
      return res.status(400).json({
        error:
          `Cannot request final quote from status '${item.currentStatus}'.`,
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'pending_final_quote_onsite',
        async (tx) => {
          const [result] = await tx
            .update(jobItems)
            .set({
              repairLocation: 'customer_site',

              requestedComponents:
                requestedComponents || null,

              diagnosisNotes:
                additionalNotes || null,

              currentStatus:
                'pending_final_quote_onsite',

              updatedAt: new Date(),
            })
            .where(eq(jobItems.id, jobItemId))
            .returning();

          await tx.insert(jobComments).values({
            jobItemId,
            userId: transportPersonId,
            comment,
          });

          return result;
        },
        transportPersonId,
        comment,
      );

    return res.status(200).json({
      message:
        'Final quote requested. CS team will prepare the customer quote.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Request final quote error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/**
 * REJECT ITEM
 *
 * transport_inspection
 *          ↓
 * repair_rejected
 */








/**
 * GET DELIVERY JOBS
 */
export const getAssignedDeliveryJobs = async (
  req: Request,
  res: Response,
) => {
  try {
    const transportPersonId = getUserId(req);

    const deliveryJobs = await db
      .select()
      .from(jobs)
      .where(
        eq(
          jobs.assignedDeliveryTechId,
          transportPersonId,
        ),
      )
      .orderBy(desc(jobs.createdAt));

    return res.status(200).json({
      jobs: deliveryJobs,
    });
  } catch (error) {
    console.error(
      'Get delivery jobs error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/**
 * START DELIVERY
 *
 * Job-level.
 *
 * pending_transport_delivery
 *          ↓
 * out_for_delivery
 */
export const startDelivery = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { jobId, comment } =
      req.body as StartDeliveryInput;

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      res.status(404).json({
        message: 'Job not found',
      });
      return;
    }

    if (job.currentStatus !== 'in_progress') {
      res.status(400).json({
        message: 'Job is not active',
      });
      return;
    }

    if (
      !isAuthorizedForJob(
        job,
        userId,
        req.user?.roles,
      )
    ) {
      res.status(403).json({
        message:
          'You are not assigned to deliver this job',
      });
      return;
    }

    const items = await db
      .select()
      .from(jobItems)
      .where(eq(jobItems.jobId, jobId));

    if (items.length === 0) {
      res.status(400).json({
        message: 'Job has no items',
      });
      return;
    }

    const invalidItems = items.filter(
      (item) =>
        item.currentStatus !== 'ready_for_delivery',
    );

    if (invalidItems.length > 0) {
      res.status(400).json({
        message:
          'All job items must be ready for delivery before starting delivery',
      });
      return;
    }

    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .update(jobItems)
          .set({
            currentStatus: 'out_for_delivery',
            updatedAt: new Date(),
          })
          .where(eq(jobItems.id, item.id));

        await tx
          .insert(jobItemStatusHistory)
          .values({
            jobItemId: item.id,
            previousStatus: 'ready_for_delivery',
            newStatus: 'out_for_delivery',
            changedBy: userId,
            note: comment,
          });

        await tx
          .insert(jobComments)
          .values({
            jobItemId: item.id,
            userId,
            comment,
          });
      }

      // Job status remains `in_progress`.
      // Delivery status is tracked by the items.
      await tx
        .update(jobs)
        .set({
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));

      // Optional job-level comment recording
      // that delivery has started.
      await tx
        .insert(jobComments)
        .values({
          jobId,
          userId,
          comment,
        });
    });

    res.status(200).json({
      message: 'Delivery started successfully',
      jobId,
      itemCount: items.length,
    });
  } catch (error) {
    console.error(
      'Error starting delivery:',
      error,
    );

    res.status(500).json({
      message: 'Failed to start delivery',
    });
  }
};


/**
 * DELIVER ITEM
 *
 * ready_for_delivery
 *          ↓
 * out_for_delivery
 *
 *          ↓
 * delivered
 *
 * The item is marked delivered here.
 *
 * Job-level completion should be handled
 * by the central job-summary service.
 */
export const deliverItem = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userId = getUserId(req);
    const { jobItemId, comment } =
      req.body as DeliverItemInput;

    const [item] = await db
      .select()
      .from(jobItems)
      .where(eq(jobItems.id, jobItemId))
      .limit(1);

    if (!item) {
      res.status(404).json({
        message: 'Job item not found',
      });
      return;
    }

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, item.jobId))
      .limit(1);

    if (!job) {
      res.status(404).json({
        message: 'Job not found',
      });
      return;
    }

    if (job.currentStatus !== 'in_progress') {
      res.status(400).json({
        message: 'Job is not active',
      });
      return;
    }

    if (
      !isAuthorizedForJob(
        job,
        userId,
        req.user?.roles,
      )
    ) {
      res.status(403).json({
        message:
          'You are not assigned to deliver this job',
      });
      return;
    }

    if (item.currentStatus !== 'out_for_delivery') {
      res.status(400).json({
        message:
          'Item must be out for delivery before it can be delivered',
      });
      return;
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        jobItemId,
        'out_for_delivery',
        'delivered',
        async (tx) => {
          return tx
            .update(jobItems)
            .set({
              currentStatus: 'delivered',
              updatedAt: new Date(),
            })
            .where(eq(jobItems.id, jobItemId))
            .returning();
        },
        userId,
        comment,
      );

    res.status(200).json({
      message: 'Item delivered successfully',
      item: updatedItem[0],
    });
  } catch (error) {
    console.error(
      'Error delivering item:',
      error,
    );

    res.status(500).json({
      message: 'Failed to deliver item',
    });
  }
};