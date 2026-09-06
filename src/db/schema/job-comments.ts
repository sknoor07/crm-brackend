import {
  pgTable,
  uuid,
  text,
  timestamp,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { users } from './users.js';
import { jobs } from './jobs.js';
import { jobItems } from './job-items.js';

export const jobComments = pgTable('job_comments',{
    id: uuid('id').defaultRandom().primaryKey(),

    jobId: uuid('job_id').references(() => jobs.id),

    jobItemId: uuid('job_item_id').references(() => jobItems.id),

    userId: uuid('user_id').references(() => users.id).notNull(),

    comment: text('comment').notNull(),

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    commentTargetCheck: check(
      'comment_target_check',
      sql`
        ("job_id" IS NOT NULL AND "job_item_id" IS NULL)
        OR
        ("job_id" IS NULL AND "job_item_id" IS NOT NULL)
      `,
    ),
  }),
);