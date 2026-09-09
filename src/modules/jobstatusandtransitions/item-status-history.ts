import { db } from '../../config/database.js';

import {
  JobItemStatus,
  jobComments,
  jobItemStatusHistory,
} from '../../db/schema/index.js';


// --------------------------------------------------
// Database transaction type
// --------------------------------------------------

export type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];


// --------------------------------------------------
// Allowed job item status transitions
// --------------------------------------------------

export const allowedJobItemTransitions: Record<
  string,
  JobItemStatus[]
> = {
  created: [
    'pending_cs_verification',//g
  ],

  pending_cs_verification: [
    'approved_for_transport',//g
    'repair_rejected',//g
  ],

  approved_for_transport: [
    'transport_visit_in_progress',//g
  ],

  transport_visit_in_progress: [
    'repair_rejected',         
    'pending_final_quote_onsite',//onsite
    'pending_lab_receipt',//onsite to inlab
  ],

  pending_final_quote_onsite: [//cs team will have this status 
    'awaiting_customer_approval', //customer will approve after getting quote
    'repair_rejected', //or may be the cs team reejcts the repair after communication with transport_person
  ],

  pending_lab_receipt: [
    'received_at_lab', //both transport_person and transport_manager will ahve this status 
  ],

  received_at_lab: [ //transport_manager will mark item as received at lab 
    'pending_repair_assignment',
  ],

  pending_repair_assignment: [ // repair_manager will assign to someone to repair
    'assigned_to_repair_person', 
  ],

  assigned_to_repair_person: [ // assigned repair peroson
    'pending_final_quote_inlab',    //the assigned repair person can either send the job for revised quoatation
    'reapir_finished',   //or he can finish the job may be unrepaired or no need for quotation or finish after customer accepted the quotataion
  ],

  pending_final_quote_inlab: [
    'awaiting_customer_approval', //cs team sends the final quoate for approval 
    'inlab_repair_rejected',  //or may be repair rejected and will send to transport_manager to send back
  ],


  inlab_repair_rejected:[
    'ready_for_delivery' // if after final quote customer does not accepts then cs team will send the item for return
  ]
  awaiting_customer_approval: [ // customer can have both status for inlab and onsite as per the location the options will be available
    'repair_authorized_onsite', // //customer see the quote and approves 
    'repair_authorised_inlab', // cutomer authorised the reapir
    'customer_onsite_repair_reject',
    'customer_inlab_repair_reject'
  ],

  customer_inlab_repair_reject:[
    'pending_final_quote_inlab',
  ]

  customer_onsite_repair_reject:[
    pending_final_quote_onsite,
  ]

  repair_authorised_inlab:[
    'assigned_to_repair_person',// if customer authorised the reapir then notify the repair perosn too start the job.
  ]
  repair_authorized_onsite:[ // repair person onsite see and repair and delivers
    'delivered',
  ],

  reapir_finished:[
    'pending_repair_manager_inspection', //repair manaegr will inspeact
    
  ]

  pending_repair_manager_inspection: [ 
    'pending_repair_assignment', // after isnpeaction can assign someone else to fix
    'ready_for_delivery', // go for delivery
    'assigned_to_repair_person', // asign the same persont o fix
  ],

  ready_for_delivery: [ // transport manager will asssign someone to deliver
    'out_for_delivery', 
  ],

  out_for_delivery: [ // transport_person will transition from out_for_deliver to delivered
    'delivered',
  ],

  delivered: [],

  repair_rejected: [],

  cancelled: [],
};


// --------------------------------------------------
// Update job item with status transition
// --------------------------------------------------

export const updateJobItemWithStatusTransition = async <T>(
  jobItemId: string,
  previousStatus: JobItemStatus | null,
  newStatus: JobItemStatus,
  updateJobItem: (
    tx: DbTransaction,
  ) => Promise<T>,
  changedBy: string,
  note: string,
  existingTx?: DbTransaction,
): Promise<T> => {

  // If previous status is null, treat the item as newly created.
  const effectivePreviousStatus  = previousStatus ?? 'created';

  // ------------------------------------------------
  // Validate transition
  // ------------------------------------------------

  if (
    !allowedJobItemTransitions[effectivePreviousStatus ]?.includes(
      newStatus,
    )
  ) {
    throw new Error(
      `Invalid job item status transition: ${effectivePreviousStatus } -> ${newStatus}`,
    );
  }

  // ------------------------------------------------
  // Execute transition
  // ------------------------------------------------

  const executeTransition = async (
    tx: DbTransaction,
  ): Promise<T> => {

    // Update the actual job item
    const updatedJobItem = await updateJobItem(tx);

    // Record status history
    await tx.insert(jobItemStatusHistory).values({
      jobItemId,
      previousStatus:effectivePreviousStatus ,
      newStatus,
      changedBy,
      note,
    });

    // Record item comment
    await tx.insert(jobComments).values({
      jobItemId,
      userId: changedBy,
      comment: note,
    });

    return updatedJobItem;
  };


  // ------------------------------------------------
  // Use existing transaction when provided
  // ------------------------------------------------

  if (existingTx) {
    return executeTransition(existingTx);
  }


  // ------------------------------------------------
  // Otherwise create a new transaction
  // ------------------------------------------------

  return db.transaction(async (tx) => {
    return executeTransition(tx);
  });
};