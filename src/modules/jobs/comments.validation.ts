import { z } from 'zod';

export const addCommentSchema = z
  .object({
    jobId: z
      .string()
      .uuid('Invalid job ID format')
      .optional(),

    jobItemId: z
      .string()
      .uuid('Invalid job item ID format')
      .optional(),

    comment: z
      .string()
      .trim()
      .min(1, 'Comment cannot be empty')
      .max(
        2000,
        'Comment cannot exceed 2000 characters',
      ),
  })
  .refine(
    (data) =>
      (data.jobId && !data.jobItemId) ||
      (!data.jobId && data.jobItemId),
    {
      message:
        'Provide either jobId or jobItemId, but not both',
      path: ['jobId'],
    },
  );

export type AddCommentInput =
  z.infer<typeof addCommentSchema>;