import { z } from 'zod';

// --------------------------------------------------
// Component
// --------------------------------------------------

export const estimatedComponentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Component name is required'),

  quantity: z
    .number()
    .int()
    .positive('Quantity must be greater than 0'),

  unitPrice: z
    .number()
    .nonnegative('Unit price cannot be negative'),
});

export type EstimatedComponentInput = z.infer<
  typeof estimatedComponentSchema
>;

// --------------------------------------------------
// CS decision for individual job item
// --------------------------------------------------

export const csApproveJobItemSchema = z
  .object({
    jobItemId: z
      .string()
      .uuid('Invalid job item ID'),

    decision: z.enum([
      'approved',
      'rejected',
    ]),

    comment: z
      .string()
      .trim()
      .min(1, 'Comment is required')
      .max(2000, 'Comment cannot exceed 2000 characters'),

    estimatedComponents: z
      .array(estimatedComponentSchema)
      .default([]),
  })

  // ------------------------------------------------
  // Business rules
  // ------------------------------------------------

  .superRefine((item, ctx) => {
    // Approved item MUST have estimated components
    if (
      item.decision === 'approved' &&
      item.estimatedComponents.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedComponents'],
        message:
          'Estimated components are required for an approved item',
      });
    }

    // Rejected item MUST NOT have estimated components
    if (
      item.decision === 'rejected' &&
      item.estimatedComponents.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedComponents'],
        message:
          'Rejected items cannot have estimated components',
      });
    }
  });

export type CSApproveJobItemInput = z.infer<
  typeof csApproveJobItemSchema
>;

// --------------------------------------------------
// Complete CS job approval request
// --------------------------------------------------

export const csApproveJobAndJobItemSchema = z.object({
  jobId: z
    .string()
    .uuid('Invalid job ID'),

  comment: z
    .string()
    .trim()
    .min(1, 'Job comment is required')
    .max(2000, 'Job comment cannot exceed 2000 characters'),

  items: z
    .array(csApproveJobItemSchema)
    .min(1, 'At least one job item is required'),
});

export type CSApproveJobAndJobItemInput = z.infer<
  typeof csApproveJobAndJobItemSchema
>;


// --------------------------------------------------
// Generate final quote
// --------------------------------------------------

export const generateFinalQuoteSchema = z.object({
  jobItemId: z
    .string()
    .uuid('Invalid job item ID format'),

  components: z
    .array(estimatedComponentSchema)
    .min(
      1,
      'At least one component is required',
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

export type GenerateFinalQuoteInput = z.infer<
  typeof generateFinalQuoteSchema
>;

// --------------------------------------------------
// Get customer details
// --------------------------------------------------

export const csGetCustomerDetail = z.object({
  id: z
    .string()
    .uuid('Invalid customer ID'),
});

export type CsGetCustomerDetail = z.infer<
  typeof csGetCustomerDetail
>;


export const searchCustomerSchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, 'Search query is required'),
});



export const closeJobSchema = z.object({jobId: z.string().uuid('Invalid job ID format'),

  customerConfirmed: z.literal(true, 'Customer confirmation is required before closing the job'),

  paymentConfirmed: z.literal(true, {message:'Payment confirmation is required before closing the job',}),

  closureReason: z.string().trim().min(1, 'Closing remarks are required').max(2000, 'Closing remarks cannot exceed 2000 characters'),
});

export type CloseJobInput =
  z.infer<typeof closeJobSchema>;