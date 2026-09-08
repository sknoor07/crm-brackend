import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';

import { jobs } from './jobs.js';
import { users } from './users.js';

export const jobClosures = pgTable('job_closures', {
  id: uuid('id').defaultRandom().primaryKey(),

  jobId: uuid('job_id').references(() => jobs.id).notNull().unique(),

  closedByUserId: uuid('closed_by_user_id').references(() => users.id).notNull(),

  closingRemarks: text('closure_reason'),

  customerConfirmed: boolean('customer_confirmed',).default(false),

  notes: text('notes'),

  closedAt: timestamp('closed_at').defaultNow(),
});