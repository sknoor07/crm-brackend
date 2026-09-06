import {
  pgTable,
  uuid,
  decimal,
  timestamp,
  integer,
  boolean,
  varchar,
  unique,
} from 'drizzle-orm/pg-core';

import { jobItems } from './job-items.js';
import { users } from './users.js';

export const jobItemQuotes = pgTable('job_item_quotes',{
    id: uuid('id').defaultRandom().primaryKey(),

    jobItemId: uuid('job_item_id').references(() => jobItems.id).notNull(),
    
    version: integer('version').notNull(),

    componentsCost: decimal('components_cost',{precision: 10,scale: 2,},).notNull(),

    serviceCharge: decimal('service_charge',{precision: 10,scale: 2,},).notNull(),

    totalAmount: decimal('total_amount',{precision: 10,scale: 2,},).notNull(),

    createdByUserId: uuid('created_by_user_id',).references(() => users.id).notNull(),

    customerApproved: boolean('customer_approved',),

    customerRespondedAt: timestamp('customer_responded_at',),

    status: varchar('status', {length: 30,}).notNull().default('pending_customer_approval'),

    createdAt: timestamp('created_at',).defaultNow().notNull(),
  },

  (table) => ({
    quoteVersionUnique: unique().on(
      table.jobItemId,
      table.version,
    ),
  }),
);

export type JobItemQuote =
  typeof jobItemQuotes.$inferSelect;

export type NewJobItemQuote =
  typeof jobItemQuotes.$inferInsert;