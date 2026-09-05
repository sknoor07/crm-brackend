import { z } from 'zod';

export const quoteResponseSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  decision: z.enum(['accept', 'reject'], {
    message:
      "Decision must be either 'accept' or 'reject'",
  }),

  // Customer comments are optional.
  comment: z
    .string()
    .trim()
    .max(2000, 'Comment cannot exceed 2000 characters')
    .optional(),
});

export type QuoteResponseInput =
  z.infer<typeof quoteResponseSchema>;

export const createCustomerJobSchema = z.object({
  deviceCategory: z
    .string()
    .min(1, 'Device category is required'),

  issueDescription: z
    .string()
    .min(
      5,
      'Issue description must be at least 5 characters',
    ),

  // Customer comments are optional.
  comment: z
    .string()
    .trim()
    .max(2000, 'Comment cannot exceed 2000 characters')
    .optional(),
});

export type CreateCustomerJobInput =
  z.infer<typeof createCustomerJobSchema>;