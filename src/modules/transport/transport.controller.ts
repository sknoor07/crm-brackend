import { Request, Response } from 'express';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
} from 'drizzle-orm';

import { db } from '../../config/database.js';

import {
  jobs,
  jobItems,
  jobComments,
  jobItemStatusHistory,
  roles,
  userRoles,
  users,
  employeeProfiles,
  customerProfiles,
} from '../../db/schema/index.js';

import type {
  AssignTransportPersonInput,
  ReceiveLabInput,
  AssignDeliveryInput,
  AssignRepairManagerInput,
} from './transport.validation.js';

import type {
  JobItemStatus,
} from '../../db/schema/job-status.js';
import { error } from 'node:console';
import { updateJobItemWithStatusTransition } from '../jobstatusandtransitions/item-status-history.js';
import { transitionJob } from '../jobstatusandtransitions/transition-job.js';


/* =========================================================
   HELPERS
   ========================================================= */


/**
 * Check whether an employee is active and has
 * the transport_team_person role.
 *
 * A transport person may also have repair_person,
 * but they must have transport_team_person for
 * transport-team operations.
 */
const isActiveTransportPerson = async (userId: string,) => {
  const [employee] = await db.select({ id: users.id, })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id),)
    .innerJoin(roles, eq(userRoles.roleId, roles.id),)
    .where(and(eq(users.id, userId), eq(users.userType, 'employee'), eq(users.isActive, true), inArray(roles.name, ['transport_team_person',]),),)
    .limit(1);

  return Boolean(employee);
};


/**
 * Check whether an employee can perform delivery.
 *
 * Delivery is handled by the transport team,
 * so transport_team_person is sufficient.
 */
const isActiveDeliveryPerson = async (
  userId: string,
) => {
  return isActiveTransportPerson(userId);
};


/**
 * Get all items belonging to a job.
 */
const getJobItems = async (jobId: string,) => {
  return db.select().from(jobItems).where(eq(jobItems.jobId, jobId));
};


/**
 * Record an item-level status change.
 *
 * This is used only by this controller for the
 * item transitions handled by Transport Manager.
 */
const recordItemStatusChange = async (
  tx: any,
  jobItemId: string,
  previousStatus: JobItemStatus | null,
  newStatus: JobItemStatus,
  changedBy: string,
  note: string,
) => {
  await tx
    .insert(jobItemStatusHistory)
    .values({
      jobItemId,
      previousStatus,
      newStatus,
      changedBy,
      note,
    });
};


/**
 * Add a job-level comment.
 */
const addJobComment = async (tx: any, jobId: string, userId: string, comment: string,) => {
  await tx.insert(jobComments).values({ jobId, userId, comment, });
};


/**
 * Add an item-level comment.
 */
const addItemComment = async (
  tx: any,
  jobItemId: string,
  userId: string,
  comment: string,
) => {
  await tx
    .insert(jobComments)
    .values({
      jobItemId,
      userId,
      comment,
    });
};


/* =========================================================
   1. GET JOBS WAITING FOR TRANSPORT MANAGER
   ========================================================= */

/**
get all jobs and items pending for pickups
 */
export const getPendingPickups = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user || !user.roles?.includes('transport_manager')) {
      return res.status(401).json({ error: "Unauthorised User" });
    }

    // 1. Fetch jobs, items, and customers together in a single query
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
          eq(jobs.currentStatus, 'assigning_pickup_Engineer'),
          eq(jobItems.currentStatus, 'approved_for_transport')
        )
      )
      .orderBy(desc(jobs.createdAt));

    // 2. Group the flat SQL rows into a nested object
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
      count: groupedJobs.length,
      jobs: groupedJobs
    });

  } catch (error) {
    console.error('Fetch pending transport jobs error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

/**
Assign a pending job to a transport team person.
 */
export const assignTransportPerson = async (req: Request<{}, {}, AssignTransportPersonInput>, res: Response,) => {
  try {
    const { jobId, transportPersonId, comment, } = req.body;
    const transportManagerId = req.user?.userId;

    if (!transportManagerId) {
      return res.status(401).json({ error: 'Authenticated user not found', });
    }

    /* -----------------------------------------------------
       Find job
       ----------------------------------------------------- */

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) {
      return res.status(404).json({ error: 'Job not found', });
    }

    if (job.assignedTransportTeamPersonId !== null) {
      return res.status(400).json({ error: "Job Already Assigned" })
    }

    /* -----------------------------------------------------
       Job must still be active
       ----------------------------------------------------- */

    if (job.currentStatus !== 'assigning_pickup_Engineer') {
      return res.status(400).json({ error: `Job cannot be assigned in '${job.currentStatus}' status.`, });
    }
    /* -----------------------------------------------------
       Validate transport person
       ----------------------------------------------------- */

    if (!(await isActiveTransportPerson(transportPersonId,))) {
      return res.status(400).json({ error: 'Assigned person must be an active employee with the transport_team_person role.', });
    }

    /* -----------------------------------------------------
       Check that job has items waiting for transport
       ----------------------------------------------------- */

    const items = await getJobItems(jobId);
    if (items.length === 0) {
      return res.status(400).json({ error: 'Cannot assign transport person because the job has no items.', });
    }

    const itemsWaitingForTransport = items.filter((item) => item.currentStatus === 'approved_for_transport',);

    if (itemsWaitingForTransport.length === 0) {
      return res.status(400).json({ error: 'Job has no items waiting for transport.', });
    }

    /* -----------------------------------------------------
       Assign transport person
       ----------------------------------------------------- */

    const result = await db.transaction(
      async (tx) => {
        const updatedJob = await transitionJob({
          jobId: job.id,
          previousStatus: job.currentStatus,
          newStatus: 'pending_visit',
          changedBy: transportManagerId,
          note: comment.trim(),
          existingTx: tx,


          updateJob: async (tx) => {
            const [updated] = await tx.update(jobs).set({ transportManagerId, assignedTransportTeamPersonId: transportPersonId, currentStatus: 'pending_visit', updatedAt: new Date(), })
              .where(eq(jobs.id, jobId),).returning();
            if (!updated) {
              throw new Error('Failed to update job',);
            }
            return updated;
          },
        });


        const updatedItems = [];

        for (const item of itemsWaitingForTransport) {
          const updatedItem = await updateJobItemWithStatusTransition(
            item.id,
            item.currentStatus,
            'transport_visit_in_progress',

            async (tx) => {
              const [updated] = await tx.update(jobItems).set({ currentStatus: 'transport_visit_in_progress', updatedAt: new Date(), })
                .where(eq(jobItems.id, item.id),).returning();
              if (!updated) {
                throw new Error('Failed to Update Job Items');
              }
              return updated;
            },
            transportManagerId,
            comment.trim(),
            tx,
          );
          updatedItems.push(updatedItem);
        }

        return { job: updatedJob, items: updatedItems };

      },

    );
    return res.status(200).json({ message: 'Transport person assigned successfully.', job: result.job, items: result.items, });


  } catch (error) {
    console.error('Assign transport person error:', error,);

    return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to assign transport person', });
  }
};


/*Get list of pickup person */

export const getPickUpPersonList = async (req: Request, res: Response) => {
  try {
    const pickupPersonDetails = await db
      .select({
        userId: users.id,
        email: users.email,
        userType: users.userType,
        firstName: employeeProfiles.firstName,
        lastName: employeeProfiles.lastName,
        fullName: sql<string>`${employeeProfiles.firstName} || ' ' || ${employeeProfiles.lastName}`,
        phone: employeeProfiles.phone,
        specializations: employeeProfiles.specializations,
      })
      .from(users)
      .innerJoin(employeeProfiles, eq(users.id, employeeProfiles.userId))
      .innerJoin(userRoles, eq(users.id, userRoles.userId))
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(users.userType, 'employee'),
          eq(roles.name, 'transport_team_person')
        )
      );
    res.status(200).json({ message: "Employee Fetch Successfully", pickupPersonDetails });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "cannot fetch transportpersons" });
  }
}







///////////////////////done////////////////


















/* =========================================================
   3. RECEIVE ITEM AT LAB
   ========================================================= */

/**
 * Receive an item at the lab.
 *
 * Transition:
 *
 *     pending_lab_receipt
 *              ↓
 *     received_at_lab
 *
 * This is an ITEM-level transition.
 */

export const receiveAtLab = async (
  req: Request<{}, {}, ReceiveLabInput>,
  res: Response,
) => {
  try {
    const {
      jobItemId,
      jobItemIds,
      comment,
    } = req.body;

    const transportManagerId =
      req.user?.userId;

    if (!transportManagerId) {
      return res.status(401).json({
        error: 'Authenticated user not found',
      });
    }

    /* -----------------------------------------------------
       Validate input
       ----------------------------------------------------- */

    const hasSingleItem = !!jobItemId;

    const hasBatchItems =
      Array.isArray(jobItemIds) &&
      jobItemIds.length > 0;

    if (hasSingleItem && hasBatchItems) {
      return res.status(400).json({
        error:
          'Provide either jobItemId or jobItemIds, not both.',
      });
    }

    if (!hasSingleItem && !hasBatchItems) {
      return res.status(400).json({
        error:
          'Either jobItemId or jobItemIds is required.',
      });
    }

    /* -----------------------------------------------------
       Normalize IDs
       ----------------------------------------------------- */

    const itemIds = hasSingleItem
      ? [jobItemId!]
      : jobItemIds!;

    const uniqueItemIds =
      new Set(itemIds);

    if (
      uniqueItemIds.size !==
      itemIds.length
    ) {
      return res.status(400).json({
        error:
          'Duplicate job item IDs are not allowed.',
      });
    }

    /* -----------------------------------------------------
       Find items
       ----------------------------------------------------- */

   const existingItems: (typeof jobItems.$inferSelect)[] = [];

    for (const id of itemIds) {
      const [item] = await db
        .select()
        .from(jobItems)
        .where(eq(jobItems.id, id))
        .limit(1);

      if (!item) {
        return res.status(404).json({
          error:
            `Job item ${id} not found.`,
        });
      }

      existingItems.push(item);
    }

    /* -----------------------------------------------------
       Ensure all items belong to same job
       ----------------------------------------------------- */

    const jobIds = new Set(
      existingItems.map(
        (item) => item.jobId,
      ),
    );

    if (jobIds.size !== 1) {
      return res.status(400).json({
        error:
          'All job items must belong to the same job.',
      });
    }

    const jobId =
      existingItems[0].jobId;

    /* -----------------------------------------------------
       Find job
       ----------------------------------------------------- */

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found.',
      });
    }

    /* -----------------------------------------------------
       Validate transport manager
       ----------------------------------------------------- */

    if (
      job.transportManagerId !==
      transportManagerId
    ) {
      return res.status(403).json({
        error:
          'You are not assigned as the transport manager for this job.',
      });
    }

    /* -----------------------------------------------------
       Validate job status
       ----------------------------------------------------- */

    if (job.currentStatus !== 'going_to_lab') {
      return res.status(400).json({
        error:
          `Items cannot be received at lab when job status is ` +
          `'${job.currentStatus}'.`,
      });
    }

    /* -----------------------------------------------------
       Validate item statuses
       ----------------------------------------------------- */

    const invalidItems =
      existingItems.filter(
        (item) =>
          item.currentStatus !==
          'pending_lab_receipt',
      );

    if (invalidItems.length > 0) {
      return res.status(400).json({
        error:
          'All selected items must be in pending_lab_receipt status.',
        items: invalidItems.map(
          (item) => ({
            jobItemId: item.id,
            currentStatus:
              item.currentStatus,
          }),
        ),
      });
    }

    /* -----------------------------------------------------
       Process items in transaction
       ----------------------------------------------------- */

    const result =
      await db.transaction(async (tx) => {
        const updatedItems = [];

        for (const item of existingItems) {
          const updatedItem =
            await updateJobItemWithStatusTransition(
              item.id,
              item.currentStatus as JobItemStatus,
              'received_at_lab',
              async (transaction) => {
                const [updated] =
                  await transaction
                    .update(jobItems)
                    .set({
                      currentStatus:
                        'received_at_lab',

                      onsiteRepairAuthorized:
                        false,

                      inlabRepairAuthorized:
                        true,

                      updatedAt:
                        new Date(),
                    })
                    .where(
                      eq(
                        jobItems.id,
                        item.id,
                      ),
                    )
                    .returning();

                return updated;
              },
              transportManagerId,
              comment?.trim() ||
                'Item received at the lab.',
              tx,
            );

          updatedItems.push(
            updatedItem,
          );
        }

        await tx
          .insert(jobComments)
          .values({
            jobId,
            jobItemId: null,
            userId:
              transportManagerId,
            comment:
              comment?.trim() ||
              (
                updatedItems.length === 1
                  ? 'Item received at the lab.'
                  : 'Items received at the lab.'
              ),
          });

        return {
          job,
          items: updatedItems,
        };
      });

    /* -----------------------------------------------------
       Response
       ----------------------------------------------------- */

    return res.status(200).json({
      message:
        result.items.length === 1
          ? 'Item successfully received at the lab.'
          : 'Items successfully received at the lab.',

      count: result.items.length,

      data: result,
    });
  } catch (error) {
    console.error(
      'Receive item at lab error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while receiving item at lab',
    });
  }
};




/* =========================================================
   4. GET JOBS READY FOR DELIVERY
   ========================================================= */

/**
 * Get jobs where all items are ready for delivery.
 *
 * Job remains:
 *
 *     in_progress
 *
 * Items:
 *
 *     ready_for_delivery
 */
export const getPendingDeliveries = async (
  _req: Request,
  res: Response,
) => {
  try {
    const candidateRows = await db
      .select({
        job: jobs,
        jobItem: jobItems,
      })
      .from(jobs)
      .innerJoin(
        jobItems,
        eq(
          jobItems.jobId,
          jobs.id,
        ),
      )
      .where(
        and(
          eq(
            jobs.currentStatus,
            'in_progress',
          ),
          eq(
            jobItems.currentStatus,
            'ready_for_delivery',
          ),
        ),
      )
      .orderBy(
        desc(jobs.updatedAt),
      );

    /* -----------------------------------------------------
       Group items by job
       ----------------------------------------------------- */

    const jobMap = new Map<
      string,
      {
        job: typeof candidateRows[number]['job'];
        items: typeof candidateRows[number]['jobItem'][];
      }
    >();

    for (const row of candidateRows) {
      const existing =
        jobMap.get(row.job.id);

      if (existing) {
        existing.items.push(
          row.jobItem,
        );
      } else {
        jobMap.set(
          row.job.id,
          {
            job: row.job,
            items: [row.jobItem],
          },
        );
      }
    }

    /* -----------------------------------------------------
       Verify that ALL items in each job are ready
       ----------------------------------------------------- */

    const readyJobs = [];

    for (const entry of jobMap.values()) {
      const allItems =
        await getJobItems(
          entry.job.id,
        );

      const allItemsReady =
        allItems.length > 0 &&
        allItems.every(
          (item) =>
            item.currentStatus ===
            'ready_for_delivery',
        );

      if (allItemsReady) {
        readyJobs.push({
          job: entry.job,
          items: allItems,
        });
      }
    }

    return res.status(200).json({
      count: readyJobs.length,
      jobs: readyJobs,
    });
  } catch (error) {
    console.error(
      'Fetch pending deliveries error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/* =========================================================
   5. ASSIGN WHOLE JOB FOR DELIVERY
   ========================================================= */

/**
 * Assign the whole job to a delivery person.
 *
 * IMPORTANT:
 *
 * This only records the delivery person.
 *
 * It does NOT change the job status.
 *
 * Job remains:
 *
 *     in_progress
 *
 * Items remain:
 *
 *     ready_for_delivery
 *
 * until delivery actually starts.
 */
export const assignDelivery = async (
  req: Request<
    {},
    {},
    AssignDeliveryInput
  >,
  res: Response,
) => {
  try {
    const {
      jobId,
      deliveryPersonId,
      comment,
    } = req.body;

    const transportManagerId =
      req.user?.userId;

    if (!transportManagerId) {
      return res.status(401).json({
        error:
          'Authenticated user not found',
      });
    }

    /* -----------------------------------------------------
       Find job
       ----------------------------------------------------- */

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

    /* -----------------------------------------------------
       Job must still be active
       ----------------------------------------------------- */

    if (
      job.currentStatus !==
      'in_progress'
    ) {
      return res.status(400).json({
        error:
          `Cannot assign delivery when job is '${job.currentStatus}'.`,
      });
    }

    /* -----------------------------------------------------
       Validate delivery person
       ----------------------------------------------------- */

    if (
      !(await isActiveDeliveryPerson(
        deliveryPersonId,
      ))
    ) {
      return res.status(400).json({
        error:
          'Delivery person must be an active employee with the transport_team_person role.',
      });
    }

    /* -----------------------------------------------------
       Get all job items
       ----------------------------------------------------- */

    const items = await getJobItems(
      jobId,
    );

    if (items.length === 0) {
      return res.status(400).json({
        error:
          'Cannot assign delivery because the job has no items.',
      });
    }

    /* -----------------------------------------------------
       Every item must be ready for delivery
       ----------------------------------------------------- */

    const allItemsReady =
      items.every(
        (item) =>
          item.currentStatus ===
          'ready_for_delivery',
      );

    if (!allItemsReady) {
      return res.status(400).json({
        error:
          'All job items must be ready_for_delivery before delivery can be assigned.',
      });
    }

    /* -----------------------------------------------------
       Assign delivery person
       ----------------------------------------------------- */

    const updatedJob =
      await db.transaction(async (tx) => {
        const [result] = await tx
          .update(jobs)
          .set({
            assignedDeliveryTechId:
              deliveryPersonId,
            transportManagerId,
            updatedAt: new Date(),
          })
          .where(
            eq(
              jobs.id,
              jobId,
            ),
          )
          .returning();

        await addJobComment(
          tx,
          jobId,
          transportManagerId,
          comment,
        );

        return result;
      });

    return res.status(200).json({
      message:
        'Delivery person assigned successfully.',
      job: updatedJob,
    });
  } catch (error) {
    console.error(
      'Assign delivery error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


const isActiveRepairManager = async (
  userId: string,
): Promise<boolean> => {
  const [manager] = await db
    .select({
      id: users.id,
    })
    .from(users)
    .innerJoin(
      userRoles,
      eq(userRoles.userId, users.id),
    )
    .innerJoin(
      roles,
      eq(userRoles.roleId, roles.id),
    )
    .where(
      and(
        eq(users.id, userId),
        eq(users.userType, 'employee'),
        eq(users.isActive, true),
        eq(roles.name, 'repair_manager'),
      ),
    )
    .limit(1);

  return Boolean(manager);
};

export const getRepairManagers = async (
  req: Request,
  res: Response,
) => {
  try {
    const managers = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: employeeProfiles.firstName,
        lastName: employeeProfiles.lastName,
        phone: employeeProfiles.phone,
      })
      .from(users)
      .innerJoin(
        userRoles,
        eq(userRoles.userId, users.id),
      )
      .innerJoin(
        roles,
        eq(userRoles.roleId, roles.id),
      )
      .leftJoin(
        employeeProfiles,
        eq(
          employeeProfiles.userId,
          users.id,
        ),
      )
      .where(
        and(
          eq(users.userType, 'employee'),
          eq(users.isActive, true),
          eq(roles.name, 'repair_manager'),
        ),
      )
      .orderBy(asc(users.email));

    return res.status(200).json({
      count: managers.length,
      managers,
    });
  } catch (error) {
    console.error(
      'Get repair managers error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


export const assignRepairManager = async (req: Request<{},{},AssignRepairManagerInput>,res: Response,) => {
  try {
    const {
      jobId,
      repairManagerId,
      comment,
    } = req.body;

    const transportManagerId =
      req.user?.userId;

    if (!transportManagerId) {
      return res.status(401).json({
        error: 'Authenticated user not found',
      });
    }

    /* -----------------------------------------------------
       Find job
       ----------------------------------------------------- */

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

    /* -----------------------------------------------------
       Validate transport manager authorization
       ----------------------------------------------------- */

    if (job.transportManagerId !== transportManagerId) {
      return res.status(403).json({
        error:
          'You are not assigned as the transport manager for this job',
      });
    }

    /* -----------------------------------------------------
       Validate job status
       ----------------------------------------------------- */

    if (
      job.currentStatus !== 'going_to_lab' &&
      job.currentStatus !== 'repair_in_progress'
    ) {
      return res.status(400).json({
        error:
          `Cannot assign Repair Team Manager when job is ` +
          `'${job.currentStatus}'.`,
      });
    }

    /* -----------------------------------------------------
       Validate Repair Team Manager
       ----------------------------------------------------- */

    const repairManagerActive =
      await isActiveRepairManager(
        repairManagerId,
      );

    if (!repairManagerActive) {
      return res.status(400).json({
        error:
          'Assigned user must be an active employee with the repair_manager role.',
      });
    }

    /* -----------------------------------------------------
       Find lab items ready for Repair Manager assignment
       ----------------------------------------------------- */

    const labItems = await db
      .select()
      .from(jobItems)
      .where(
        and(
          eq(jobItems.jobId, jobId),
          eq(
            jobItems.currentStatus,
            'received_at_lab',
          ),
        ),
      );

    if (labItems.length === 0) {
      return res.status(400).json({
        error:
          'No job items are currently received at the lab and ready for Repair Team Manager assignment.',
      });
    }

    /* -----------------------------------------------------
       Assign manager + transition items + update job
       atomically
       ----------------------------------------------------- */

    const updatedJob =
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(jobs)
          .set({
            repairManagerId,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, jobId))
          .returning();

        if (!updated) {
          throw new Error(
            'Job could not be updated',
          );
        }

        /* -----------------------------------------------
           Move received lab items to
           assigned_to_repair_manager
           ----------------------------------------------- */

        for (const item of labItems) {
          await updateJobItemWithStatusTransition(
            item.id,
            item.currentStatus as JobItemStatus,
            'assigned_to_repair_manager',
            async (transaction) => {
              const [updatedItem] =
                await transaction
                  .update(jobItems)
                  .set({
                    currentStatus:
                      'assigned_to_repair_manager',
                    updatedAt: new Date(),
                  })
                  .where(
                    eq(jobItems.id, item.id),
                  )
                  .returning();

              return updatedItem;
            },
            transportManagerId,
            comment ||
              'Item assigned to Repair Team Manager',
            tx,
          );
        }

        /* -----------------------------------------------
           Move job into repair phase
           ----------------------------------------------- */

        if (job.currentStatus === 'going_to_lab') {
          await transitionJob({
            jobId,
            previousStatus:
              job.currentStatus,
            newStatus:
              'repair_in_progress',
            changedBy:
              transportManagerId,
            note:
              comment ||
              'Repair Team Manager assigned and lab repair process started',
            updateJob: async (transaction) => {
              const [result] =
                await transaction
                  .update(jobs)
                  .set({
                    currentStatus:
                      'repair_in_progress',
                    updatedAt: new Date(),
                  })
                  .where(
                    eq(jobs.id, jobId),
                  )
                  .returning();

              return result;
            },
            existingTx: tx,
          });
        } else if (comment) {
          /* ---------------------------------------------
             Job is already in repair_in_progress.
             Record an assignment comment only when
             the user supplied one.
             --------------------------------------------- */

          await tx
            .insert(jobComments)
            .values({
              jobId,
              userId:
                transportManagerId,
              comment,
            });
        }

        return updated;
      });

    return res.status(200).json({
      message:
        'Repair Team Manager assigned successfully.',
      job: updatedJob,
      assignedItemCount: labItems.length,
    });
  } catch (error) {
    console.error(
      'Assign repair manager error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};
