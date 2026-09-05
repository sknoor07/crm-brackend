import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../../config/database.js';

import {
  jobComments,
  jobs,
  jobItems,
} from '../../db/schema/index.js';

import {
  AddCommentInput,
} from './comments.validation.js';

export const addJobComment = async (
  req: Request<{}, {}, AddCommentInput>,
  res: Response,
) => {
  try {
    const {
      jobId,
      jobItemId,
      comment,
    } = req.body;

    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        error: 'Authenticated user not found',
      });
    }

    // ---------------------------------------------
    // Job-level comment
    // ---------------------------------------------

    if (jobId) {
      const [job] = await db
        .select({
          id: jobs.id,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job) {
        return res.status(404).json({
          error: 'Job not found',
        });
      }
    }

    // ---------------------------------------------
    // Item-level comment
    // ---------------------------------------------

    if (jobItemId) {
      const [jobItem] = await db
        .select({
          id: jobItems.id,
        })
        .from(jobItems)
        .where(
          eq(
            jobItems.id,
            jobItemId,
          ),
        )
        .limit(1);

      if (!jobItem) {
        return res.status(404).json({
          error: 'Job item not found',
        });
      }
    }

    // ---------------------------------------------
    // Insert comment
    // ---------------------------------------------

    const [newComment] =
      await db
        .insert(jobComments)
        .values({
          jobId: jobId ?? null,
          jobItemId: jobItemId ?? null,
          userId,
          comment,
        })
        .returning();

    return res.status(201).json({
      message: 'Comment added successfully',
      comment: newComment,
    });
  } catch (error) {
    console.error(
      'Add comment error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while adding comment',
    });
  }
};