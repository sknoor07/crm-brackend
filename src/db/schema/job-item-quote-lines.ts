import {
  pgTable,
  uuid,
  decimal,
  timestamp,
  integer,
  varchar,
} from 'drizzle-orm/pg-core';

import { jobItemQuotes } from './job-item-quotes.js';

export const jobItemQuoteLines = pgTable('job_item_quote_lines', {
  id: uuid('id').defaultRandom().primaryKey(),

  quoteId: uuid('quote_id')
    .references(() => jobItemQuotes.id, { onDelete: 'cascade' })
    .notNull(),

  name: varchar('name', { length: 200 }).notNull(),

  quantity: integer('quantity').notNull().default(1),

  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),

  lineTotal: decimal('line_total', { precision: 10, scale: 2 }).notNull(),

  sortOrder: integer('sort_order').notNull().default(0),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type JobItemQuoteLine = typeof jobItemQuoteLines.$inferSelect;

export type NewJobItemQuoteLine = typeof jobItemQuoteLines.$inferInsert;
