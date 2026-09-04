import { Request, Response } from 'express';
import { db } from '../../config/database.js';
import { jobComments, jobs } from '../../db/schema/index.js';
import { AddCommentInput } from './comments.validation.js';
import { eq } from 'drizzle-orm';

export const addJobComment = async (req: Request<{}, {}, AddCommentInput>, res: Response) => {
  try {
    const { jobId, comment } = req.body;
    const userId = req.user?.userId!; // Extract ID from the authenticated token

    // 1. Verify the job exists
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // 2. Insert the comment
    const [newComment] = await db.insert(jobComments).values({
      jobId,
      userId,
      comment,
    }).returning();

    return res.status(201).json({
      message: 'Comment added successfully',
      comment: newComment,
    });

  } catch (error) {
    console.error('Add comment error:', error);
    return res.status(500).json({ error: 'Internal server error while adding comment' });
  }
};