import {
  pgEnum,
  pgTable,
  uuid,
  decimal,
  timestamp,
  integer,
  unique,
} from 'drizzle-orm/pg-core';

import { jobs } from './jobs.js';
import { users } from './users.js';

export const jobQuoteStatus = pgEnum(
  'job_quote_status',
  [
    'estimate',
    'pending',
    'final',
    'rejected',
  ],
);

export const jobQuotes = pgTable(
  'job_quotes',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    jobId: uuid('job_id')
      .references(() => jobs.id)
      .notNull(),

    version: integer('version').notNull(),

    subtotal: decimal('subtotal', {
      precision: 10,
      scale: 2,
    }).notNull(),

    serviceCharge: decimal('service_charge', {
      precision: 10,
      scale: 2,
    }).notNull(),

    discount: decimal('discount', {
      precision: 10,
      scale: 2,
    }).notNull(),

    tax: decimal('tax', {
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

    status: jobQuoteStatus('status')
      .notNull()
      .default('estimate'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    quoteVersionUnique: unique().on(
      table.jobId,
      table.version,
    ),
  }),
);

export type JobQuote = typeof jobQuotes.$inferSelect;
export type NewJobQuote = typeof jobQuotes.$inferInsert;