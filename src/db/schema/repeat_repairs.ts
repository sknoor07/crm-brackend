import { pgTable, uuid,text, timestamp, varchar, integer } from 'drizzle-orm/pg-core';


export const repeatRepairs = pgTable('repeat_repairs', {
  id: uuid('id').defaultRandom().primaryKey(),
  deviceSerialNumber: varchar('device_serial_number', { length: 50 }).notNull(),
  jobId: uuid('job_id').notNull(), // Current job
  originalJobId: uuid('original_job_id').notNull(), // First job with this issue
  problemDescription: text('problem_description').notNull(),
  firstRepairDate: timestamp('first_repair_date').notNull(),
  repeatCount: integer('repeat_count').default(1),
  lastRepeatDate: timestamp('last_repeat_date'),
  daysSinceFirstRepair: integer('days_since_first_repair'),
  status: varchar('status', { length: 20 }).default('active'), // active, resolved
  createdAt: timestamp('created_at').defaultNow(),
});

export type RepeatRepair = {
  id: string;
  deviceSerialNumber: string;
  jobId: string;
  originalJobId: string;
  problemDescription: string;
  firstRepairDate: Date;
  repeatCount: number;
  lastRepeatDate?: Date;
  daysSinceFirstRepair: number;
};