import { z } from 'zod';

export const jobIdParamsSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),
});

export const startTransportJobSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const inspectJobItemSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Inspection comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const sendItemToLabSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Lab transfer comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
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
export type StartTransportJobInput =
  z.infer<typeof startTransportJobSchema>;

export type InspectJobItemInput =
  z.infer<typeof inspectJobItemSchema>;

export type SendItemToLabInput =
  z.infer<typeof sendItemToLabSchema>;

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