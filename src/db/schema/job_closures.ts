import { pgTable, uuid,text,boolean, timestamp } from 'drizzle-orm/pg-core';

export const jobClosures = pgTable('job_closures', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').notNull().unique(),
  closedByUserId: uuid('closed_by_user_id').notNull(),
  closureReason: text('closure_reason'),
  customerConfirmed: boolean('customer_confirmed').default(false),
  paymentConfirmed: boolean('payment_confirmed').default(false),
  notes: text('notes'),
  closedAt: timestamp('closed_at').defaultNow(),
});

export type JobClosure = {
  id: string;
  jobId: string;
  closedByUserId: string;
  closureReason?: string;
  customerConfirmed: boolean;
  paymentConfirmed: boolean;
  notes?: string;
  closedAt: Date;
};