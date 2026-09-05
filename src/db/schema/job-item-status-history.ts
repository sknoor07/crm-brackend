import {
  pgTable,
  uuid,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';
import { jobItems } from './job-items.js';
import { jobItemStatus } from './job-status.js';

export const jobItemStatusHistory =
  pgTable(
    'job_item_status_history',
    {
      id: uuid('id')
        .defaultRandom()
        .primaryKey(),

      jobItemId: uuid('job_item_id')
        .references(() => jobItems.id)
        .notNull(),

      previousStatus: jobItemStatus(
        'previous_status',
      ),

      newStatus: jobItemStatus(
        'new_status',
      ).notNull(),

      changedBy: uuid('changed_by')
        .references(() => users.id)
        .notNull(),

      note: text('note'),

      createdAt: timestamp('created_at')
        .defaultNow()
        .notNull(),
    },
  );