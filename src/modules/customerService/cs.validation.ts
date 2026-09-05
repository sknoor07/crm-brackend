import { z } from 'zod';

export const csApproveJobItemSchema = z.object({
  jobItemId: z.string().uuid(
    'Invalid job item ID format',
  ),

  estimatedComponentsCost: z
  .number()
  .nonnegative(
    'Estimated components cost must be 0 or greater',
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

export type CSApproveJobItemInput =
  z.infer<typeof csApproveJobItemSchema>;


export const csRejectJobItemSchema = z.object({
  jobItemId: z.string().uuid(
    'Invalid job item ID format',
  ),

  comment: z
    .string()
    .trim()
    .min(1, 'Rejection comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type CSRejectJobItemInput =
  z.infer<typeof csRejectJobItemSchema>;



export const closeJobSchema = z.object({
  jobId: z.string().uuid(
    'Invalid job ID format',
  ),

  customerConfirmed: z.literal(true, {
    message:
      'Customer confirmation is required before closing the job',
  }),

  paymentConfirmed: z.literal(true, {
    message:
      'Payment confirmation is required before closing the job',
  }),

  closingRemarks: z
    .string()
    .trim()
    .min(1, 'Closing remarks are required')
    .max(
      2000,
      'Closing remarks cannot exceed 2000 characters',
    ),
});

export type CloseJobInput =
  z.infer<typeof closeJobSchema>;


export const generateFinalQuoteSchema = z.object({
  jobItemId: z.string().uuid(
    'Invalid job item ID format',
  ),

  finalComponentsCost: z
    .number()
    .nonnegative(
      'Final components cost must be 0 or greater',
    ),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});
export type GenerateFinalQuoteInput =
  z.infer<typeof generateFinalQuoteSchema>;


export const confirmOnsiteRepairSchema = z.object({
  jobItemId: z.string().uuid(
    'Invalid job item ID format',
  ),

  customerConfirmed: z.literal(true, {
    message:
      'Customer confirmation is required',
  }),

  comment: z
    .string()
    .trim()
    .min(
      1,
      'Confirmation comment is required',
    )
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});
export type ConfirmOnsiteRepairInput =
  z.infer<typeof confirmOnsiteRepairSchema>;