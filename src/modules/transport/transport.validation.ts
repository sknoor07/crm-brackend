import { z } from 'zod';

export const assignTransportPersonSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  transportPersonId: z.string().uuid('Invalid transport person ID format'),

  comment: z.string().trim().min(1, 'Comment is required').max(2000, 'Comment cannot exceed 2000 characters'),
});

export type AssignTransportPersonInput =
  z.infer<typeof assignTransportPersonSchema>;


export const receiveLabSchema = z
  .object({
    jobItemId: z
      .string()
      .uuid('Invalid job item ID format')
      .optional(),

    jobItemIds: z
      .array(
        z
          .string()
          .uuid('Invalid job item ID format'),
      )
      .min(
        1,
        'At least one job item ID is required',
      )
      .optional(),

    comment: z
      .string()
      .trim()
      .min(1, 'Comment is required')
      .max(
        2000,
        'Comment cannot exceed 2000 characters',
      )
      .optional(),
  })
  .refine(
    (data) =>
      !!data.jobItemId !==
      !!data.jobItemIds,
    {
      message:
        'Provide either jobItemId or jobItemIds, not both.',
      path: ['jobItemId'],
    },
  );

export type ReceiveLabInput =
  z.infer<typeof receiveLabSchema>;


export const assignDeliverySchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  deliveryPersonId: z
    .string()
    .uuid('Invalid delivery person ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export type AssignDeliveryInput =
  z.infer<typeof assignDeliverySchema>;

  export const assignRepairManagerSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  repairManagerId: z
    .string()
    .uuid('Invalid repair manager ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export type AssignRepairManagerInput =
  z.infer<typeof assignRepairManagerSchema>;

  