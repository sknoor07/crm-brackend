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
} from '../../db/schema/index.js';

import {
  updateJobItemWithStatusTransition,
} from '../jobs/item-status-history.js';

import type {
  JobItemStatus,
} from '../../db/schema/job-status.js';
import { DeliverItemInput, StartDeliveryInput } from './transportPerson.validation.js';


type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];


/**
 * Returns the authenticated user's ID.
 */
const getUserId = (req: Request): string => {
  if (!req.user?.userId) {
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
export const getAssignedJobs = async (
  req: Request,
  res: Response,
) => {
  try {
    const transportPersonId = getUserId(req);

    const assignedJobs = await db
      .select()
      .from(jobs)
      .where(
        eq(
          jobs.assignedTransportTeamPersonId,
          transportPersonId,
        ),
      )
      .orderBy(desc(jobs.createdAt));

    return res.status(200).json({
      jobs: assignedJobs,
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
 * START CUSTOMER VISIT
 *
 * Job-level operation.
 *
 * pending_transport_team_person
 *          ↓
 * transport_team_person_working
 */
export const startTransportJob = async (
  req: Request,
  res: Response,
) => {
  try {
    const transportPersonId = getUserId(req);

    const {
      jobId,
      comment,
    } = req.body;

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

    if (job.currentStatus !== 'in_progress') {
      return res.status(400).json({
        error:
          `Cannot start transport visit for job with status '${job.currentStatus}'.`,
      });
    }

    const [updatedJob] = await db
      .update(jobs)
      .set({
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId))
      .returning();

    await db.insert(jobComments).values({
      jobId,
      userId: transportPersonId,
      comment,
    });

    return res.status(200).json({
      message: 'Customer visit has been started.',
      job: updatedJob,
    });
  } catch (error) {
    console.error(
      'Start transport job error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/**
 * GET ITEMS FOR INSPECTION
 */
export const getItemsForInspection = async (
  req: Request,
  res: Response,
) => {
  try {
    const transportPersonId = getUserId(req);
    const jobId = Array.isArray(req.params.jobId)
      ? req.params.jobId[0]
      : req.params.jobId;

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

    const items = await db
      .select()
      .from(jobItems)
      .where(eq(jobItems.jobId, jobId))
      .orderBy(asc(jobItems.createdAt));

    return res.status(200).json({
      jobId,
      items,
    });
  } catch (error) {
    console.error(
      'Get transport job items error:',
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
export const inspectJobItem = async (
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
 * SEND ITEM TO LAB
 *
 * transport_inspection
 *          ↓
 * pending_lab_receipt
 */
export const sendItemToLab = async (
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
      'transport_inspection'
    ) {
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
      'transport_inspection'
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
 * START ONSITE REPAIR
 *
 * Customer has already approved the quote.
 *
 * repair_authorized
 *          ↓
 * repair_in_progress
 */
export const startOnsiteRepair = async (
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

    if (item.repairLocation !== 'customer_site') {
      return res.status(400).json({
        error:
          'This item is not configured for onsite repair.',
      });
    }

    if (
      item.currentStatus !==
      'repair_authorized'
    ) {
      return res.status(400).json({
        error:
          `Repair cannot start from status '${item.currentStatus}'. Customer approval is required first.`,
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'repair_in_progress',
        async (tx) => {
          const [result] = await tx
            .update(jobItems)
            .set({
              currentStatus:
                'repair_in_progress',
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
        'Onsite repair has started.',
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
 * COMPLETE ONSITE REPAIR
 *
 * repair_in_progress
 *          ↓
 * pending_cs_confirmation
 */
export const completeOnsiteRepair = async (
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

    if (item.repairLocation !== 'customer_site') {
      return res.status(400).json({
        error:
          'This item is not an onsite repair item.',
      });
    }

    if (
      item.currentStatus !==
      'repair_in_progress'
    ) {
      return res.status(400).json({
        error:
          `Cannot complete repair from status '${item.currentStatus}'.`,
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'pending_cs_confirmation',
        async (tx) => {
          const [result] = await tx
            .update(jobItems)
            .set({
              currentStatus:
                'pending_cs_confirmation',
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
        'Onsite repair completed. CS team has been notified for customer confirmation.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Complete onsite repair error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


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