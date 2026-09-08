import { z } from 'zod';

export const quoteComponentSchema = z.object({
  name: z.string().trim().min(1, 'Component name is required').max(200, 'Component name cannot exceed 200 characters'),
  quantity: z.number().int().positive('Quantity must be at least 1').default(1),
  unitPrice: z.number().nonnegative('Unit price must be 0 or greater'),
});

export type QuoteComponentInput = z.infer<typeof quoteComponentSchema>;

export const csApproveJobItemSchema = z
  .object({
    jobItemId: z.string().uuid('Invalid job item ID format'),
    decision: z.enum(['approved', 'rejected']).optional(),
    estimatedComponents: z.array(quoteComponentSchema).optional(),
    comment: z.string().trim().min(1, 'Comment is required').max(2000, 'Comment cannot exceed 2000 characters'),
  })
  .strict()
  .superRefine((item, ctx) => {
    // If explicitly rejected, components are not required.
    if (item.decision === 'rejected') {
      return;
    }

    // If approved OR decision is omitted,
    // the item will be treated as approved.
    if (!item.estimatedComponents || item.estimatedComponents.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedComponents'],
        message: 'Estimated components are required for an approved item',
      });
    }
  });
  export type CSApproveJobItemInput = z.infer<typeof csApproveJobItemSchema>;

export const csApproveJobAndJobItemSchema = z
  .object({
    jobId: z.string().uuid('Invalid Job Id'),

    items: z.array(csApproveJobItemSchema).min(1, 'Provide at least one Job Item'),

    isApprovedByCS: z.boolean(),

    comment: z.string().trim().min(1, 'Comment is required').max(2000, 'Comment cannot exceed 2000 characters'),
  })
  .strict();

export type CSApproveJobAndJobItemInput = z.infer<typeof csApproveJobAndJobItemSchema>;

export const csRejectJobItemSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  comment: z.string().trim().min(1, 'Rejection comment is required').max(2000, 'Comment cannot exceed 2000 characters'),
});

export type CSRejectJobItemInput =
  z.infer<typeof csRejectJobItemSchema>;



export const closeJobSchema = z.object({jobId: z.string().uuid('Invalid job ID format'),

  customerConfirmed: z.literal(true, 'Customer confirmation is required before closing the job'),

  paymentConfirmed: z.literal(true, {message:'Payment confirmation is required before closing the job',}),

  closingRemarks: z.string().trim().min(1, 'Closing remarks are required').max(2000, 'Closing remarks cannot exceed 2000 characters'),
});

export type CloseJobInput =
  z.infer<typeof closeJobSchema>;


export const generateFinalQuoteSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  components: z
    .array(quoteComponentSchema)
    .min(1, 'At least one component is required'),

  comment: z.string().trim().min(1, 'Comment is required').max(2000, 'Comment cannot exceed 2000 characters'),
});
export type GenerateFinalQuoteInput =
  z.infer<typeof generateFinalQuoteSchema>;


export const confirmOnsiteRepairSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  customerConfirmed: z.literal(true, {message:'Customer confirmation is required',}),

  comment: z.string().trim().min(1, 'Confirmation comment is required').max(2000, 'Comment cannot exceed 2000 characters'),
});
export type ConfirmOnsiteRepairInput =
  z.infer<typeof confirmOnsiteRepairSchema>;

export const csGetCustomerDetail = z.object({
  id: z.string().uuid(),
});

export type CsGetCusotmerDeatil =
  z.infer<typeof csGetCustomerDetail>;