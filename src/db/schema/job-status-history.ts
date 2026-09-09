import {
  pgTable,
  uuid,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';
import { jobs } from './jobs.js';
import { jobSummaryStatus } from './job-status.js';

export const jobStatusHistory = pgTable('job_status_history',{
    id: uuid('id').defaultRandom().primaryKey(),

    jobId: uuid('job_id').references(() => jobs.id).notNull(),

    previousStatus: jobSummaryStatus('previous_status',).notNull(),

    newStatus: jobSummaryStatus('new_status',).notNull(),

    changedBy: uuid('changed_by').references(() => users.id),

    note: text('note'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
);