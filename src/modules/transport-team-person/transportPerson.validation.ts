import { z } from 'zod';

export const jobIdParamsSchema = z.object({
  id: z.string().uuid('Invalid job ID format'),
});

export const startTransportJobSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

/**
 * Transport person inspects the entire job in one request.
 *
 * For each item they only decide:
 * - onsite
 * - lab
 * - reject
 *
 * Pricing and components are handled later by CS.
 */
export const completeTransportInspectionSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  /**
   * Optional job-level comment.
   *
   * Used for information that applies to the
   * overall job, such as requesting an item to
   * be added or removed.
   */
  comment: z
    .string()
    .trim()
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    )
    .optional(),

  /**
   * Inspection result for every job item.
   */
  items: z
    .array(
      z.object({
        jobItemId: z.string().uuid(
          'Invalid job item ID format',
        ),

        decision: z.enum([
          'onsite',
          'lab',
          'reject',
        ]),

        /**
         * Optional comment specific to this item.
         */
        comment: z
          .string()
          .trim()
          .max(
            2000,
            'Item comment cannot exceed 2000 characters',
          )
          .optional(),
      }),
    )
    .min(
      1,
      'At least one item inspection is required',
    ),
});

export const requestFinalQuoteSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  /**
   * Optional because a final quote may contain
   * only the service charge.
   */
  requestedComponents: z
    .string()
    .trim()
    .optional(),

  additionalNotes: z
    .string()
    .trim()
    .max(2000, 'Notes cannot exceed 2000 characters')
    .optional(),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const rejectJobItemSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Rejection comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const startAndFinishOnsiteRepairSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Repair start comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const completeOnsiteRepairSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Repair completion comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const startDeliverySchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Delivery start comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export const deliverItemSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Delivery comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type JobIdParamsSchema= z.infer<typeof jobIdParamsSchema>;
export type StartTransportJobInput =
  z.infer<typeof startTransportJobSchema>;

export type CompleteTransportInspectionInput =
  z.infer<typeof completeTransportInspectionSchema>;

export type RequestFinalQuoteInput =
  z.infer<typeof requestFinalQuoteSchema>;

export type RejectJobItemInput =
  z.infer<typeof rejectJobItemSchema>;

export type StartAndFinishOnsiteRepairInput =
  z.infer<typeof startAndFinishOnsiteRepairSchema>;

export type CompleteOnsiteRepairInput =
  z.infer<typeof completeOnsiteRepairSchema>;

export type StartDeliveryInput =
  z.infer<typeof startDeliverySchema>;

export type DeliverItemInput =
  z.infer<typeof deliverItemSchema>;
