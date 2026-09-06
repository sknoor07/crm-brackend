import {
  pgTable,
  uuid,
  varchar,
  decimal,
  timestamp,
} from 'drizzle-orm/pg-core';

export const deviceServiceCharges = pgTable('device_service_charges', {
  id: uuid('id').defaultRandom().primaryKey(),

  deviceCategory: varchar('device_category', {length: 100,}).notNull().unique(),
  
  chargeAmount: decimal('charge_amount', {precision: 10,scale: 2,}).notNull(),
  
  createdAt: timestamp('created_at').defaultNow(),
});