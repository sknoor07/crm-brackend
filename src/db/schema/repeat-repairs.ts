import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
} from 'drizzle-orm/pg-core';

import { jobItems } from './job-items.js';

export const repeatRepairs = pgTable(
  'repeat_repairs',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    currentJobItemId: uuid('current_job_item_id',).references(() => jobItems.id).notNull(),

    originalJobItemId: uuid('original_job_item_id',).references(() => jobItems.id).notNull(),

    deviceSerialNumber: varchar('device_serial_number',{length: 50,},).notNull(),

    problemDescription: text('problem_description',).notNull(),

    firstRepairDate: timestamp('first_repair_date',).notNull(),

    repeatCount: integer('repeat_count',).default(1),

    lastRepeatDate: timestamp('last_repeat_date',),

    daysSinceFirstRepair: integer('days_since_first_repair',),

    status: varchar('status', {length: 20,}).default('active'),

    createdAt: timestamp('created_at',).defaultNow(),
  },
);