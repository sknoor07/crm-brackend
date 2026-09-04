import { z } from 'zod';

export const quoteResponseSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  decision: z.enum({ accept: 'accept', reject: 'reject' }, {
    message: "Decision must be either 'accept' or 'reject'"
  }),
});

export type QuoteResponseInput = z.infer<typeof quoteResponseSchema>;

export const createCustomerJobSchema = z.object({
  deviceCategory: z.string().min(1, "Device category is required"),
  issueDescription: z.string().min(5, "Issue description must be at least 5 characters"),
});

export type CreateCustomerJobInput = z.infer<typeof createCustomerJobSchema>;