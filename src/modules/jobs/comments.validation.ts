import { z } from 'zod';

export const addCommentSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  comment: z.string().min(1, "Comment cannot be empty"),
});

export type AddCommentInput = z.infer<typeof addCommentSchema>;