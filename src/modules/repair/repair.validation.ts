import { z } from 'zod';

/*
 * ============================================================
 * REPAIR TEAM MANAGER
 * ============================================================
 */

/**
 * Assign an individual job item to a Repair Person.
 *
 * Item status:
 *
 * pending_repair_assignment
 *            ↓
 * assigned_to_repair_person
 */
export const assignRepairPersonSchema = z.object({
  jobItemId: z
    .string()
    .uuid('Invalid job item ID format'),

  repairPersonId: z
    .string()
    .uuid('Invalid repair person ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type AssignRepairPersonInput =
  z.infer<typeof assignRepairPersonSchema>;


/*
 * ============================================================
 * REPAIR PERSON
 * ============================================================
 */

/**
 * Start diagnosis on an assigned repair item.
 *
 * assigned_to_repair_person
 *            ↓
 * diagnosis_in_progress
 */
export const startDiagnosisSchema = z.object({
  jobItemId: z
    .string()
    .uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(
      1,
      'Diagnosis start comment is required',
    )
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type StartDiagnosisInput =
  z.infer<typeof startDiagnosisSchema>;


/**
 * Complete diagnosis and send the item to CS
 * for the final customer quotation.
 *
 * diagnosis_in_progress
 *            ↓
 * pending_final_quote
 *
 * requestedComponents is optional because:
 *
 * - the repair may require no additional components
 * - service charge may still apply
 * - CS must still generate the final quote
 */
export const requestFinalQuoteSchema = z.object({
  jobItemId: z
    .string()
    .uuid('Invalid job item ID format'),

  requestedComponents: z
    .string()
    .trim()
    .max(
      2000,
      'Requested components cannot exceed 2000 characters',
    )
    .optional(),

  diagnosisNotes: z
    .string()
    .trim()
    .max(
      2000,
      'Diagnosis notes cannot exceed 2000 characters',
    )
    .optional(),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type RequestFinalQuoteInput =
  z.infer<typeof requestFinalQuoteSchema>;


/**
 * Start an authorized repair.
 *
 * repair_authorized
 *        ↓
 * repair_in_progress
 *
 * Customer approval must already have happened.
 */
export const startRepairSchema = z.object({
  jobItemId: z
    .string()
    .uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(
      1,
      'Repair start comment is required',
    )
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type StartRepairInput =
  z.infer<typeof startRepairSchema>;


/**
 * Complete a lab repair.
 *
 * repair_in_progress
 *        ↓
 * pending_repair_manager_inspection
 *
 * The Repair Manager must inspect the repair
 * before it can proceed to delivery.
 */
export const completeRepairSchema = z.object({
  jobItemId: z
    .string()
    .uuid('Invalid job item ID format'),

  repairNotes: z
    .string()
    .trim()
    .max(
      2000,
      'Repair notes cannot exceed 2000 characters',
    )
    .optional(),

  comment: z
    .string()
    .trim()
    .min(
      1,
      'Repair completion comment is required',
    )
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type CompleteRepairInput =
  z.infer<typeof completeRepairSchema>;


/*
 * ============================================================
 * REPAIR TEAM MANAGER INSPECTION
 * ============================================================
 */

/**
 * Approve a completed repair.
 *
 * pending_repair_manager_inspection
 *              ↓
 * repair_manager_approved
 */
export const approveRepairSchema = z.object({
  jobItemId: z
    .string()
    .uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(
      1,
      'Inspection comment is required',
    )
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type ApproveRepairInput =
  z.infer<typeof approveRepairSchema>;


/**
 * Reject a completed repair during inspection.
 *
 * pending_repair_manager_inspection
 *              ↓
 * repair_in_progress
 *
 * The existing Repair Person remains assigned.
 */
export const rejectRepairInspectionSchema =
  z.object({
    jobItemId: z
      .string()
      .uuid('Invalid job item ID format'),

    comment: z
      .string()
      .trim()
      .min(
        1,
        'Inspection rejection comment is required',
      )
      .max(
        2000,
        'Comment cannot exceed 2000 characters',
      ),
  });

export type RejectRepairInspectionInput =
  z.infer<typeof rejectRepairInspectionSchema>;