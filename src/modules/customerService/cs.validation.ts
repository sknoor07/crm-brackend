import { z } from 'zod';

export const csApproveJobSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  estimatedComponentsCost: z.number().positive("Estimated components cost must be greater than zero").optional(),
});

export type CSApproveJobInput = z.infer<typeof csApproveJobSchema>;

export const generateFinalQuoteSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  finalComponentsCost: z.number().nonnegative("Final components cost must be 0 or greater"),
});

export type GenerateFinalQuoteInput = z.infer<typeof generateFinalQuoteSchema>;

export const closeJobSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  closingRemarks: z.string().min(1, "Closing remarks cannot be empty").optional(),
});