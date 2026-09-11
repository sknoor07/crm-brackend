import {
  pgTable,
  uuid,
  decimal,
  boolean,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { jobItems } from './job-items.js';
import { users } from './users.js';
import { jobQuotes } from './job_quotes.js';

export const jobItemQuotes = pgTable('job_item_quotes', {
  id: uuid('id')
    .defaultRandom()
    .primaryKey(),

  jobQuoteId: uuid('job_quote_id')
    .references(() => jobQuotes.id, {
      onDelete: 'cascade',
    })
    .notNull(),

  jobItemId: uuid('job_item_id')
    .references(() => jobItems.id)
    .notNull(),

  componentsCost: decimal('components_cost', {
    precision: 10,
    scale: 2,
  }).notNull(),

  serviceCharge: decimal('service_charge', {
    precision: 10,
    scale: 2,
  }).notNull(),

  totalAmount: decimal('total_amount', {
    precision: 10,
    scale: 2,
  }).notNull(),

  createdByUserId: uuid('created_by_user_id')
    .references(() => users.id)
    .notNull(),

  status: varchar('status', {
    length: 20,
  })
    .notNull()
    .default('estimated'),

  createdAt: timestamp('created_at')
    .defaultNow()
    .notNull(),
});

export type JobItemQuote = typeof jobItemQuotes.$inferSelect;
export type NewJobItemQuote = typeof jobItemQuotes.$inferInsert;