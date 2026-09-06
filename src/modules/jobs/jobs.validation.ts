import { z } from 'zod';
import { quoteComponentSchema } from '../customerService/cs.validation.js';



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
    )
    .optional(),

  estimatedComponents: z
    .array(quoteComponentSchema)
    .min(1, 'Provide at least one estimated component')
    .optional(),

  // Mandatory CS comment when creating the job
  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
}).superRefine((data, ctx) => {
  if (
    data.estimatedComponents == null &&
    data.estimatedComponentsCost == null
  ) {
    ctx.addIssue({
      code: 'custom',
      message:
        'Provide estimatedComponents or estimatedComponentsCost',
      path: ['estimatedComponents'],
    });
  }
});

export type CreateJobInput =
  z.infer<typeof createJobSchema>;