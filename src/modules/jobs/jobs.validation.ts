import { z } from 'zod';

export const createJobSchema = z.object({
  // Customer details
  customerEmail: z
    .string()
    .email('Valid customer email is required'),

  customerPhone: z
    .string()
    .trim()
    .min(1, 'Customer phone is required'),

  customerFirstName: z
    .string()
    .trim()
    .min(1, 'Customer first name is required'),

  customerLastName: z
    .string()
    .trim()
    .min(1, 'Customer last name is required'),

  billingAddress: z
    .string()
    .trim()
    .min(1, 'Customer address is required'),

  // Job item details
  deviceCategory: z
    .string()
    .trim()
    .min(1, 'Device category is required'),

  deviceSerialNumber: z
    .string()
    .trim()
    .optional(),

  issueDescription: z
    .string()
    .trim()
    .min(5, 'Issue description must be at least 5 characters'),

  estimatedComponentsCost: z
    .number()
    .nonnegative(
      'Estimated components cost must be 0 or greater',
    ),

  // Mandatory CS comment when creating the job
  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type CreateJobInput =
  z.infer<typeof createJobSchema>;