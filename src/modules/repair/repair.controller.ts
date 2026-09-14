import { Request, Response } from 'express';
import {
  and,
  desc,
  eq,
} from 'drizzle-orm';

import { db } from '../../config/database.js';

import {
  jobs,
  jobItems,
  roles,
  userRoles,
  users,
} from '../../db/schema/index.js';



import {
  AssignRepairPersonInput,
  StartDiagnosisInput,
  RequestFinalQuoteInput,
  StartRepairInput,
  CompleteRepairInput,
  ApproveRepairInput,
  RejectRepairInspectionInput,
  CompleteInspection,
} from './repair.validation.js';
import { updateJobItemWithStatusTransition } from '../jobstatusandtransitions/item-status-history.js';


/*
 * ============================================================
 * HELPERS
 * ============================================================
 */


/**
 * Check whether a user is an active Repair Person.
 *
 * Used by the Repair Manager before assigning
 * an item to a Repair Person.
 */
const isActiveRepairPerson = async (
  userId: string,
): Promise<boolean> => {
  const [repairPerson] = await db
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
        eq(roles.name, 'repair_person'),
      ),
    )
    .limit(1);

  return Boolean(repairPerson);
};


/**
 * Check whether a Repair Person can work
 * on a particular item.
 *
 * Admin can access every item.
 *
 * Normal Repair Person:
 *
 * item.assignedRepairPersonId === userId
 */
const isRepairPersonAuthorized = (
  item: typeof jobItems.$inferSelect,
  userId: string,
  userRolesList: string[] = [],
): boolean => {
  if (userRolesList.includes('admin')) {
    return true;
  }

  return (
    item.assignedRepairPersonId === userId
  );
};


/**
 * Check whether a user is authorized to act
 * as the Repair Team Manager for a job.
 *
 * Admin can access every job.
 *
 * Normal Repair Manager:
 *
 * job.repairManagerId === userId
 */
const isRepairManagerAuthorized = (
  job: typeof jobs.$inferSelect,
  userId: string,
  userRolesList: string[] = [],
): boolean => {
  if (userRolesList.includes('admin')) {
    return true;
  }

  return (
    job.repairManagerId === userId &&
    userRolesList.includes('repair_manager')
  );
};


/**
 * Fetch a job item together with its parent job.
 *
 * We need both because:
 *
 * jobItems = individual repair workflow
 *
 * jobs = job-level ownership / manager information
 */
const getJobItemWithJob = async (
  jobItemId: string,
) => {
  const [result] = await db
    .select({
      item: jobItems,
      job: jobs,
    })
    .from(jobItems)
    .innerJoin(
      jobs,
      eq(jobItems.jobId, jobs.id),
    )
    .where(eq(jobItems.id, jobItemId))
    .limit(1);

  return result;
};


/*
 * ============================================================
 * REPAIR TEAM MANAGER
 * ============================================================
 */


/**
 * Get repair items waiting for assignment.
 *
 * These items have already been received at the lab
 * by the Transport Manager.
 *
 * pending_repair_assignment
 *            ↓
 *       assignment
 */
export const getPendingRepairAssignments =async (req: Request,res: Response,) => {
    try {
      const managerId =
        req.user?.userId;

      if (!managerId) {
        return res.status(401).json({
          error:
            'Authenticated user not found',
        });
      }

      const ismanager =
        req.user?.roles?.includes('repair_manager');

      const items = await db
        .select({
          job: jobs,
          item: jobItems,
        })
        .from(jobItems)
        .innerJoin(
          jobs,
          eq(jobItems.jobId, jobs.id),
        )
        .where(and(eq(jobItems.currentStatus,'assigned_to_repair_manager'),eq(jobs.repairManagerId,managerId)))
        .orderBy(
          desc(jobItems.updatedAt),
        );

      return res.status(200).json({
        count: items.length,
        items,
      });
    } catch (error) {
      console.error(
        'Fetch pending repair assignments error:',
        error,
      );

      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  };



export const getAllRepairPersons= async(req:Request,res:Response)=>{
  try{
    const reapirPersons= await db.select({users}).from(users).innerJoin(userRoles,eq(userRoles.userId,users.id)).innerJoin(roles,eq(userRoles.roleId,roles.id)).where(eq(roles.name,'repair_person'));
    res.status(200).json({"Repair Persons":reapirPersons});
  }catch(err){
    console.log(err);
    res.status(500).json({message:"can't get repair persons"})
  }
}







/**
 * Assign an individual repair item to
 * a Repair Person.
 *
 * This is ITEM-level assignment.
 *
 * pending_repair_assignment
 *            ↓
 * assigned_to_repair_person
 */

export const assignRepairPerson = async (req: Request<{},{},AssignRepairPersonInput>,res: Response,) => {
  try {
    const {
      jobItemId,
      repairPersonId,
      comment,
    } = req.body;

    const managerId =
      req.user?.userId;

    if (!managerId) {
      return res.status(401).json({
        error:
          'Authenticated user not found',
      });
    }

    const result =
      await getJobItemWithJob(jobItemId);

    if (!result) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    const {
      item,
      job,
    } = result;

    /*
     * Only the Repair Manager responsible
     * for this job can assign its items.
     */
    if (
      !isRepairManagerAuthorized(
        job,
        managerId,
        req.user?.roles,
      )
    ) {
      return res.status(403).json({
        error:
          'You are not authorized to assign repair items for this job.',
      });
    }

    /*
     * Item must have been assigned to the
     * Repair Team Manager first.
     */
    if (
      item.currentStatus !==
      'assigned_to_repair_manager'
    ) {
      return res.status(400).json({
        error:
          `Item must be 'assigned_to_repair_manager' ` +
          `to be assigned to a Repair Person. ` +
          `Current status: '${item.currentStatus}'.`,
      });
    }

    /*
     * Assigned user must actually be an active
     * employee with the Repair Person role.
     */
    if (
      !(await isActiveRepairPerson(
        repairPersonId,
      ))
    ) {
      return res.status(400).json({
        error:
          'Assigned user must be an active employee with the repair_person role.',
      });
    }

    /*
     * Assign Repair Person and move item into
     * the Repair Person workflow.
     */
    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'assigned_to_repair_person',

        async (
          tx: Parameters<
            Parameters<typeof db.transaction>[0]
          >[0],
        ) => {
          const [updated] = await tx
            .update(jobItems)
            .set({
              assignedRepairPersonId:
                repairPersonId,
              currentStatus: 'assigned_to_repair_person',

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

        managerId,
        comment ||
          'Repair Person assigned to item',
      );

    return res.status(200).json({
      message:
        'Repair item assigned successfully.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Assign repair person error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};













  ////////////////////////////////////////////done/////////////////////////////////////////





















/////////////////////////////////////////////////Pending//////////////////////////////////////////////////////////



/*
 * ============================================================
 * REPAIR PERSON
 * ============================================================
 */


/**
 * Get items assigned to the currently
 * authenticated Repair Person.
 *
 * Initially this returns items that have not
 * yet started diagnosis.
 */
export const getAssignedRepairItems =async (req: Request,res: Response,) => {
    try {
      const userId =
        req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          error:
            'Authenticated user not found',
        });
      }

      const items = await db
        .select({
          item: jobItems,
        })
        .from(jobItems)
        .innerJoin(
          jobs,
          eq(jobItems.jobId, jobs.id),
        )
        .where(
          and(
            eq(
              jobItems.assignedRepairPersonId,
              userId,
            ),
            eq(
              jobItems.currentStatus,
              'assigned_to_repair_person',
            ),
          ),
        )
        .orderBy(
          desc(jobItems.updatedAt),
        );

      return res.status(200).json({
        count: items.length,
        items,
      });
    } catch (error) {
      console.error(
        'Fetch assigned repair items error:',
        error,
      );

      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  };




  ////////////////////////////////////////////////////////////////done ///////////////////////////////////////////////////////



  export const requestFinalQuote = async (
    req: Request<{}, {}, CompleteInspection>,
    res: Response,
  ) => {
    try {
      const reapirPersonId = req.user?.userId;

      const {
        jobItemId,
        comment,
      } = req.body;

      if(!reapirPersonId){
        res.status(404).json({message:"Repair Person Id Not Found"});
      }

      const [existingItems] = await db
        .select()
        .from(jobItems)
        .where(
          and(eq(jobItems.jobId, jobItemId),eq(jobItems.assignedRepairPersonId,reapirPersonId))
        ).limit(1);

      if (!existingItems) {
        return res.status(400).json({
          error:
            'This job has no items to inspect.',
        });
      }

      // --------------------------------------------------
      // Find job
      // --------------------------------------------------

      const [job] = await db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, existingItems.jobId),
          ),
        )
        .limit(1);

      if (!job) {
        return res.status(404).json({
          error:
            'Job not found or not assigned to you.',
        });
      }

      // --------------------------------------------------
      // Job must be waiting for transport visit
      // --------------------------------------------------

      if (job.currentStatus !== 'repair_in_progress') {
        return res.status(400).json({
          error:
            `In Lab inspection cannot be completed when ` +
            `job status is ${job.currentStatus}.`,
        });
      }

      // --------------------------------------------------
      // Load all job items
      // --------------------------------------------------

      

      // --------------------------------------------------
      // Items that actually require inspection
      // --------------------------------------------------

      const inspectableItems =
        existingItems.filter(
          (item) =>
            item.currentStatus ===
            'transport_visit_in_progress',
        );

      if (inspectableItems.length === 0) {
        return res.status(400).json({
          error:
            'There are no job items pending transport inspection.',
        });
      }

      // --------------------------------------------------
      // Validate submitted item IDs
      // --------------------------------------------------

      const submittedItemIds = items.map(
        (item) => item.jobItemId,
      );

      const uniqueSubmittedItemIds =
        new Set(submittedItemIds);

      if (
        uniqueSubmittedItemIds.size !==
        submittedItemIds.length
      ) {
        return res.status(400).json({
          error:
            'Duplicate job item IDs are not allowed.',
        });
      }

      if (
        submittedItemIds.length !==
        inspectableItems.length
      ) {
        return res.status(400).json({
          error:
            'Inspection result must be submitted for every job item pending inspection.',
        });
      }

      const inspectableItemIds =
        new Set(
          inspectableItems.map(
            (item) => item.id,
          ),
        );

      const invalidItemId =
        submittedItemIds.find(
          (itemId) =>
            !inspectableItemIds.has(itemId),
        );

      if (invalidItemId) {
        return res.status(400).json({
          error:
            `Job item ${invalidItemId} is not ready for transport inspection.`,
        });
      }

      // --------------------------------------------------
      // Map submitted inspections
      // --------------------------------------------------

      const inspectionByItemId =
        new Map(
          items.map((item) => [
            item.jobItemId,
            item,
          ]),
        );

      // --------------------------------------------------
      // Validate decisions and determine item outcomes
      // --------------------------------------------------

      const finalItemOutcomes =
        inspectableItems.map(
          (existingItem) => {
            const inspection =
              inspectionByItemId.get(
                existingItem.id,
              );

            if (!inspection) {
              throw new Error(
                `Missing inspection for job item ${existingItem.id}.`,
              );
            }

            if (
              inspection.decision ===
              'onsite'
            ) {
              return {
                jobItemId:
                  existingItem.id,

                decision:
                  'onsite' as const,

                finalStatus:
                  'pending_final_quote' as const,
              };
            }

            if (
              inspection.decision ===
              'lab'
            ) {
              return {
                jobItemId:
                  existingItem.id,

                decision:
                  'lab' as const,

                finalStatus:
                  'pending_lab_receipt' as const,
              };
            }

            if (
              inspection.decision ===
              'reject'
            ) {
              return {
                jobItemId:
                  existingItem.id,

                decision:
                  'reject' as const,

                finalStatus:
                  'repair_rejected' as const,
              };
            }

            throw new Error(
              `Invalid inspection decision for job item ${existingItem.id}.`,
            );
          },
        );

      // --------------------------------------------------
      // Determine overall job route
      // --------------------------------------------------

      const hasLabItem =
        finalItemOutcomes.some(
          (item) =>
            item.decision === 'lab',
        );

      const hasOnsiteItem =
        finalItemOutcomes.some(
          (item) =>
            item.decision === 'onsite',
        );

      const hasRepairableItem =
        hasLabItem ||
        hasOnsiteItem;

      /*
      * ------------------------------------------------
      * IMPORTANT JOB ROUTING
      * ------------------------------------------------
      *
      * All onsite:
      *
      *   pending_visit
      *        ↓
      *   pending_final_quote
      *
      * Mixed / lab:
      *
      *   pending_visit
      *        ↓
      *   going_to_lab
      *
      * Rejected items do not require repair.
      */

      let newJobStatus:
        | 'pending_final_quote'
        | 'going_to_lab';

      if (hasLabItem) {
        newJobStatus =
          'going_to_lab';
      } else {
        newJobStatus =
          'pending_final_quote';
      }

      const jobNote =
        comment?.trim() ||
        (
          hasLabItem
            ? hasOnsiteItem
              ? 'Transport inspection completed. Some items require lab repair.'
              : 'Transport inspection completed. Items require lab repair.'
            : hasRepairableItem
              ? 'Transport inspection completed. All repairable items can be repaired onsite.'
              : 'Transport inspection completed. All items were rejected for repair.'
        );

      // --------------------------------------------------
      // Transaction
      // --------------------------------------------------

      const result =
        await db.transaction(
          async (tx) => {

            // --------------------------------------------
            // Update JOB status
            // --------------------------------------------

            await transitionJob({
              jobId,

              previousStatus:
                job.currentStatus,

              newStatus:
                newJobStatus,

              changedBy:
                transportPersonId,

              note:
                jobNote,

              updateJob:
                async (
                  transaction,
                ) => {
                  const [updatedJob] =
                    await transaction
                      .update(jobs)
                      .set({
                        currentStatus:
                          newJobStatus,

                        updatedAt:
                          new Date(),
                      })
                      .where(
                        eq(
                          jobs.id,
                          jobId,
                        ),
                      )
                      .returning();

                  return updatedJob;
                },

              existingTx: tx,
            });

            // --------------------------------------------
            // Update ITEMS
            // --------------------------------------------

            const updatedItems = [];

            for (
              const inspection of items
            ) {
              const existingItem =
                inspectableItems.find(
                  (item) =>
                    item.id ===
                    inspection.jobItemId,
                );

              if (!existingItem) {
                throw new Error(
                  `Job item ${inspection.jobItemId} not found.`,
                );
              }

              let newStatus:
                | 'pending_final_quote'
                | 'pending_lab_receipt'
                | 'repair_rejected';

              if (
                inspection.decision ===
                'onsite'
              ) {
                newStatus =
                  'pending_final_quote';
              } else if (
                inspection.decision ===
                'lab'
              ) {
                newStatus =
                  'pending_lab_receipt';
              } else {
                newStatus =
                  'repair_rejected';
              }

              const itemNote =
                inspection.comment?.trim() ||
                (
                  inspection.decision ===
                    'onsite'
                    ? 'Transport inspection completed. Item can be repaired onsite.'
                    : inspection.decision ===
                      'lab'
                      ? 'Transport inspection completed. Item requires lab repair.'
                      : 'Transport inspection completed. Item rejected for repair.'
                );

              const updatedItem =
                await updateJobItemWithStatusTransition(
                  existingItem.id,

                  existingItem.currentStatus,

                  newStatus,

                  async (
                    transaction,
                  ) => {

                    const updateData: {
                      currentStatus:
                      | 'pending_final_quote'
                      | 'pending_lab_receipt'
                      | 'repair_rejected';

                      repairLocation?:
                      | 'customer_site'
                      | 'inlab';

                      onsiteRepairAuthorized?: boolean;

                      inlabRepairAuthorized?: boolean;

                      repairFinishedOnsite?: boolean;

                      updatedAt: Date;
                    } = {
                      currentStatus: newStatus,
                      updatedAt: new Date(),
                    };

                    // --------------------------------
                    // Onsite
                    // --------------------------------

                    if (inspection.decision === 'onsite') {
                      updateData.repairLocation = 'customer_site';

                      updateData.onsiteRepairAuthorized = true;

                      updateData.inlabRepairAuthorized = false;

                      updateData.repairFinishedOnsite = false;
                    }

                    // --------------------------------
                    // Lab
                    // --------------------------------

                    if (inspection.decision === 'lab') {
                      updateData.repairLocation = 'inlab';

                      updateData.onsiteRepairAuthorized = false;

                      updateData.inlabRepairAuthorized = true;

                      updateData.repairFinishedOnsite = false;
                    }

                    // --------------------------------
                    // Rejected
                    // --------------------------------

                    if (inspection.decision === 'reject') {
                      updateData.onsiteRepairAuthorized = false;

                      updateData.inlabRepairAuthorized = false;

                      updateData.repairFinishedOnsite = false;
                    }

                    const [updated] =
                      await transaction
                        .update(jobItems)
                        .set(
                          updateData,
                        )
                        .where(
                          eq(
                            jobItems.id,
                            existingItem.id,
                          ),
                        )
                        .returning();

                    return updated;
                  },

                  transportPersonId,

                  itemNote,

                  tx,
                );

              updatedItems.push(
                updatedItem,
              );
            }

            // --------------------------------------------
            // Get final job
            // --------------------------------------------

            const [updatedJob] =
              await tx
                .select()
                .from(jobs)
                .where(
                  eq(
                    jobs.id,
                    jobId,
                  ),
                )
                .limit(1);

            return {
              job: updatedJob,
              items: updatedItems,
            };
          },
        );

      return res.status(200).json({
        message:
          'Transport inspection completed successfully.',

        data: result,
      });

    } catch (error) {

      console.error(
        'Complete transport inspection error:',
        error,
      );

      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : 'Internal server error',
      });
    }
  };





  /////////////////////////////////////////////////////pending/////////////////////////////////////////////////////////////

/**
 * Start diagnosis.
 *
 * assigned_to_repair_person
 *            ↓
 * diagnosis_in_progress
 */
export const startDiagnosis = async (req: Request<{},{},StartDiagnosisInput>,res: Response,) => {
  try {
    const {
      jobItemId,
      comment,
    } = req.body;

    const userId =
      req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        error:
          'Authenticated user not found',
      });
    }

    const result =
      await getJobItemWithJob(jobItemId);

    if (!result) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    const {
      item,
    } = result;

    if (
      !isRepairPersonAuthorized(
        item,
        userId,
        req.user?.roles,
      )
    ) {
      return res.status(403).json({
        error:
          'You are not authorized to work on this repair item.',
      });
    }

    if (
      item.currentStatus !==
      'assigned_to_repair_person'
    ) {
      return res.status(400).json({
        error:
          `Cannot start diagnosis from '${item.currentStatus}'.`,
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'diagnosis_in_progress',

        async (
          tx: Parameters<
            Parameters<typeof db.transaction>[0]
          >[0],
        ) => {
          const [updated] = await tx
            .update(jobItems)
            .set({
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

        userId,
        comment,
      );

    return res.status(200).json({
      message:
        'Diagnosis started successfully.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Start diagnosis error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/**
 * Finish diagnosis and send the item
 * to Customer Service for final quotation.
 *
 * diagnosis_in_progress
 *            ↓
 * pending_final_quote
 *
 * Repair Person provides technical information.
 *
 * CS is responsible for the customer quote.
 */


// export const requestFinalQuote = async (req: Request<{},{},RequestFinalQuoteInput>,res: Response,) => {
//   try {
//     const {
//       jobItemId,
//       requestedComponents,
//       diagnosisNotes,
//       comment,
//     } = req.body;

//     const userId =
//       req.user?.userId;

//     if (!userId) {
//       return res.status(401).json({
//         error:
//           'Authenticated user not found',
//       });
//     }

//     const result =
//       await getJobItemWithJob(jobItemId);

//     if (!result) {
//       return res.status(404).json({
//         error: 'Job item not found',
//       });
//     }

//     const {
//       item,
//       job,
//     } = result;

//     /* -----------------------------------------------------
//        Verify Repair Person authorization
//        ----------------------------------------------------- */

//     if (
//       !isRepairPersonAuthorized(
//         item,
//         userId,
//         req.user?.roles,
//       )
//     ) {
//       return res.status(403).json({
//         error:
//           'You are not authorized to diagnose this repair item.',
//       });
//     }

//     /* -----------------------------------------------------
//        Validate current item status
//        ----------------------------------------------------- */

//     if (
//       item.currentStatus !==
//       'assigned_to_repair_person'
//     ) {
//       return res.status(400).json({
//         error:
//           `Cannot complete diagnosis from ` +
//           `'${item.currentStatus}'. ` +
//           `Item must be 'assigned_to_repair_person'.`,
//       });
//     }

//     /* -----------------------------------------------------
//        Complete diagnosis and check job aggregate state
//        atomically
//        ----------------------------------------------------- */

//     const updatedItem =
//       await db.transaction(async (tx) => {
//         /*
//          * Move this item:
//          *
//          * assigned_to_repair_person
//          *             ↓
//          * pending_final_quote
//          */
//         const updated =
//           await updateJobItemWithStatusTransition(
//             item.id,

//             item.currentStatus,

//             'pending_final_quote',

//             async (transaction) => {
//               const [updatedItem] =
//                 await transaction
//                   .update(jobItems)
//                   .set({
//                     requestedComponents:
//                       requestedComponents || null,

//                     diagnosisNotes:
//                       diagnosisNotes || null,

//                     updatedAt:
//                       new Date(),
//                   })
//                   .where(
//                     eq(
//                       jobItems.id,
//                       item.id,
//                     ),
//                   )
//                   .returning();

//               return updatedItem;
//             },

//             userId,

//             comment?.trim() ||
//               'Diagnosis completed. Item sent for final quotation.',

//             tx,
//           );

//         /* -------------------------------------------------
//            Check ALL job items after this transition
//            ------------------------------------------------- */

//         const allJobItems = await tx
//           .select()
//           .from(jobItems)
//           .where(
//             eq(
//               jobItems.jobId,
//               job.id,
//             ),
//           );

//         /*
//          * These items do not participate in the
//          * final quote readiness check.
//          *
//          * repair_rejected:
//          *   Permanently rejected and not part of quote.
//          *
//          * cancelled:
//          *   No longer active.
//          *
//          * removed_from_quote:
//          *   Explicitly removed by CS.
//          */
//         const applicableItems =
//           allJobItems.filter(
//             (jobItem) =>
//               jobItem.currentStatus !==
//                 'repair_rejected' &&
//               jobItem.currentStatus !==
//                 'cancelled' &&
//               jobItem.currentStatus !==
//                 'removed_from_quote',
//           );

//         /*
//          * The job is ready for final quotation only
//          * when every applicable item is ready.
//          */
//         const allItemsReady =
//           applicableItems.length > 0 &&
//           applicableItems.every(
//             (jobItem) =>
//               jobItem.currentStatus ===
//               'pending_final_quote',
//           );

//         /* -------------------------------------------------
//            Move job into pending_final_quote only when
//            the LAST applicable item becomes ready.
//            ------------------------------------------------- */

//         if (
//           allItemsReady &&
//           job.currentStatus ===
//             'repair_in_progress'
//         ) {
//           await transitionJob({
//             jobId: job.id,

//             previousStatus:
//               job.currentStatus,

//             newStatus:
//               'pending_final_quote',

//             changedBy: userId,

//             note:
//               'All applicable job items are ready for final quotation',

//             updateJob: async (
//               transaction,
//             ) => {
//               const [updatedJob] =
//                 await transaction
//                   .update(jobs)
//                   .set({
//                     currentStatus:
//                       'pending_final_quote',

//                     updatedAt:
//                       new Date(),
//                   })
//                   .where(
//                     eq(
//                       jobs.id,
//                       job.id,
//                     ),
//                   )
//                   .returning();

//               return updatedJob;
//             },

//             existingTx: tx,
//           });
//         }

//         return updated;
//       });

//     return res.status(200).json({
//       message:
//         'Diagnosis completed. Item sent to Customer Service for final quotation.',

//       item: updatedItem,
//     });
//   } catch (error) {
//     console.error(
//       'Request final quote error:',
//       error,
//     );

//     return res.status(500).json({
//       error:
//         error instanceof Error
//           ? error.message
//           : 'Internal server error',
//     });
//   }
// };





/**
 * Start an authorized repair.
 *
 * repair_authorized
 *        ↓
 * repair_in_progress
 *
 * Customer approval must already have
 * happened through the CS workflow.
 */
export const startRepair = async (
  req: Request<
    {},
    {},
    StartRepairInput
  >,
  res: Response,
) => {
  try {
    const {
      jobItemId,
      comment,
    } = req.body;

    const userId =
      req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        error:
          'Authenticated user not found',
      });
    }

    const result =
      await getJobItemWithJob(jobItemId);

    if (!result) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    const {
      item,
    } = result;

    if (
      !isRepairPersonAuthorized(
        item,
        userId,
        req.user?.roles,
      )
    ) {
      return res.status(403).json({
        error:
          'You are not authorized to repair this item.',
      });
    }

    if (
      item.currentStatus !==
      'repair_authorized'
    ) {
      return res.status(400).json({
        error:
          `Repair cannot start from '${item.currentStatus}'. Customer approval is required first.`,
      });
    }

    /*
     * This module handles lab repairs.
     *
     * Onsite repair is handled by the
     * Transport Person workflow.
     */
    if (item.repairLocation !== 'lab') {
      return res.status(400).json({
        error:
          'This endpoint is only for lab repairs.',
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'repair_in_progress',

        async (
          tx: Parameters<
            Parameters<typeof db.transaction>[0]
          >[0],
        ) => {
          const [updated] = await tx
            .update(jobItems)
            .set({
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

        userId,
        comment,
      );

    return res.status(200).json({
      message:
        'Repair started successfully.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Start repair error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/**
 * Complete a lab repair.
 *
 * repair_in_progress
 *        ↓
 * pending_repair_manager_inspection
 *
 * The Repair Manager must inspect the item
 * before it can become ready for delivery.
 */
export const completeRepair = async (
  req: Request<
    {},
    {},
    CompleteRepairInput
  >,
  res: Response,
) => {
  try {
    const {
      jobItemId,
      repairNotes,
      comment,
    } = req.body;

    const userId =
      req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        error:
          'Authenticated user not found',
      });
    }

    const result =
      await getJobItemWithJob(jobItemId);

    if (!result) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    const {
      item,
    } = result;

    if (
      !isRepairPersonAuthorized(
        item,
        userId,
        req.user?.roles,
      )
    ) {
      return res.status(403).json({
        error:
          'You are not authorized to complete this repair.',
      });
    }

    if (
      item.currentStatus !==
      'repair_in_progress'
    ) {
      return res.status(400).json({
        error:
          `Cannot complete repair from '${item.currentStatus}'.`,
      });
    }

    /*
     * Only lab repairs go through
     * Repair Manager inspection.
     *
     * Customer-site repair uses:
     *
     * repair_in_progress
     *        ↓
     * pending_cs_confirmation
     *
     * That workflow belongs to Transport Person.
     */
    if (item.repairLocation !== 'lab') {
      return res.status(400).json({
        error:
          'This endpoint is only for lab repairs.',
      });
    }

    const updatedItem =
      await updateJobItemWithStatusTransition(
        item.id,
        item.currentStatus,
        'pending_repair_manager_inspection',

        async (
          tx: Parameters<
            Parameters<typeof db.transaction>[0]
          >[0],
        ) => {
          const [updated] = await tx
            .update(jobItems)
            .set({
              repairNotes:
                repairNotes || null,

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

        userId,
        comment,
      );

    return res.status(200).json({
      message:
        'Repair completed and sent for Repair Manager inspection.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Complete repair error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/*
 * ============================================================
 * REPAIR TEAM MANAGER INSPECTION
 * ============================================================
 */


/**
 * Get lab repairs waiting for manager inspection.
 *
 * Only items belonging to jobs managed by
 * the current Repair Manager are returned.
 */
export const getPendingRepairInspections =
  async (
    req: Request,
    res: Response,
  ) => {
    try {
      const managerId =
        req.user?.userId;

      if (!managerId) {
        return res.status(401).json({
          error:
            'Authenticated user not found',
        });
      }

      const isAdmin =
        req.user?.roles?.includes(
          'admin',
        );

      const items = await db
        .select({
          item: jobItems,
          job: jobs,
        })
        .from(jobItems)
        .innerJoin(
          jobs,
          eq(jobItems.jobId, jobs.id),
        )
        .where(
          isAdmin
            ? eq(
              jobItems.currentStatus,
              'pending_repair_manager_inspection',
            )
            : and(
              eq(
                jobItems.currentStatus,
                'pending_repair_manager_inspection',
              ),
              eq(
                jobs.repairManagerId,
                managerId,
              ),
            ),
        )
        .orderBy(
          desc(jobItems.updatedAt),
        );

      return res.status(200).json({
        count: items.length,
        items,
      });
    } catch (error) {
      console.error(
        'Fetch pending repair inspections error:',
        error,
      );

      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  };


/**
 * Approve a completed repair.
 *
 * pending_repair_manager_inspection
 *              ↓
 *       ready_for_delivery
 *
 * Once approved, the item is handed back
 * to the Transport Team workflow.
 */
export const approveRepair = async (
  req: Request<
    {},
    {},
    ApproveRepairInput
  >,
  res: Response,
) => {
  try {
    const {
      jobItemId,
      comment,
    } = req.body;

    const managerId =
      req.user?.userId;

    if (!managerId) {
      return res.status(401).json({
        error:
          'Authenticated user not found',
      });
    }

    const result =
      await getJobItemWithJob(jobItemId);

    if (!result) {
      return res.status(404).json({
        error: 'Job item not found',
      });
    }

    const {
      item,
      job,
    } = result;

    if (
      !isRepairManagerAuthorized(
        job,
        managerId,
        req.user?.roles,
      )
    ) {
      return res.status(403).json({
        error:
          'You are not authorized to inspect this repair item.',
      });
    }

    if (
      item.currentStatus !==
      'pending_repair_manager_inspection'
    ) {
      return res.status(400).json({
        error:
          `Cannot approve item from '${item.currentStatus}'.`,
      });
    }

    const updatedItem =
  await updateJobItemWithStatusTransition(
    jobItemId,
    item.currentStatus,
    'ready_for_delivery',

    async (tx) => {
      const [updated] = await tx
        .update(jobItems)
        .set({
          updatedAt: new Date(),
        })
        .where(
          eq(
            jobItems.id,
            jobItemId,
          ),
        )
        .returning();

      return updated;
    },

    managerId,
    comment,
  );

    return res.status(200).json({
      message:
        'Repair approved by Repair Team Manager.',
      item: updatedItem,
    });
  } catch (error) {
    console.error(
      'Approve repair error:',
      error,
    );

    return res.status(500).json({
      error: 'Internal server error',
    });
  }
};


/**
 * Reject a repair during manager inspection.
 *
 * pending_repair_manager_inspection
 *              ↓
 * repair_in_progress
 *
 * The same Repair Person remains assigned.
 */
export const rejectRepairInspection =
  async (
    req: Request<
      {},
      {},
      RejectRepairInspectionInput
    >,
    res: Response,
  ) => {
    try {
      const {
        jobItemId,
        comment,
      } = req.body;

      const managerId =
        req.user?.userId;

      if (!managerId) {
        return res.status(401).json({
          error:
            'Authenticated user not found',
        });
      }

      const result =
        await getJobItemWithJob(
          jobItemId,
        );

      if (!result) {
        return res.status(404).json({
          error: 'Job item not found',
        });
      }

      const {
        item,
        job,
      } = result;

      if (
        !isRepairManagerAuthorized(
          job,
          managerId,
          req.user?.roles,
        )
      ) {
        return res.status(403).json({
          error:
            'You are not authorized to inspect this repair item.',
        });
      }

      if (
        item.currentStatus !==
        'pending_repair_manager_inspection'
      ) {
        return res.status(400).json({
          error:
            `Cannot reject inspection from '${item.currentStatus}'.`,
        });
      }

      /*
       * We deliberately keep assignedRepairPersonId.
       *
       * Rejection means:
       *
       * "Repair needs more work."
       *
       * It does NOT mean:
       *
       * "Assign this item to another technician."
       */
      const updatedItem =
        await updateJobItemWithStatusTransition(
          item.id,
          item.currentStatus,
          'repair_in_progress',

          async (
            tx: Parameters<
              Parameters<typeof db.transaction>[0]
            >[0],
          ) => {
            const [updated] =
              await tx
                .update(jobItems)
                .set({
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

          managerId,
          comment,
        );

      return res.status(200).json({
        message:
          'Repair rejected during inspection. Item returned to Repair Person.',
        item: updatedItem,
      });
    } catch (error) {
      console.error(
        'Reject repair inspection error:',
        error,
      );

      return res.status(500).json({
        error: 'Internal server error',
      });
    }
  };