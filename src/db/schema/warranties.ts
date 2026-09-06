import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { jobItems } from './job-items.js';

export const warranties = pgTable('warranties', {
  id: uuid('id').defaultRandom().primaryKey(),

  jobItemId: uuid('job_item_id').references(() => jobItems.id).notNull().unique(),

  deviceSerialNumber: varchar('device_serial_number',{length: 50,},).notNull(),

  deviceImei: varchar('device_imei',{length: 50,},),

  originalRepairDate: timestamp('original_repair_date',).notNull(),

  warrantyStart: timestamp('warranty_start',).defaultNow(),

  warrantyEnd: timestamp('warranty_end',).notNull(),

  warrantyStatus: varchar('warranty_status',{length: 20,},).notNull().default('active'),

  reasonForReturn: text('reason_for_return',),

  warrantyResult: varchar('warranty_result',{length: 20,},),

  createdAt: timestamp('created_at',).defaultNow(),

  updatedAt: timestamp('updated_at',).defaultNow(),
});