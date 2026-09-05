import {
  pgTable,
  uuid,
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';
import { jobSummaryStatus } from './job-status.js';

export const jobs = pgTable('jobs', {
  id: uuid('id')
    .defaultRandom()
    .primaryKey(),

  jobNumber: varchar('job_number', {
    length: 36,
  })
    .notNull()
    .unique(),

  customerId: uuid('customer_id')
    .references(() => users.id)
    .notNull(),

  currentStatus: jobSummaryStatus(
    'current_status',
  )
    .notNull()
    .default('in_progress'),

  transportManagerId: uuid(
    'transport_manager_id',
  ).references(() => users.id),

  assignedTransportTeamPersonId: uuid(
    'assigned_transport_team_person_id',
  ).references(() => users.id),

  repairManagerId: uuid(
    'repair_manager_id',
  ).references(() => users.id),

  assignedDeliveryTechId: uuid(
    'assigned_delivery_tech_id',
  ).references(() => users.id),

  createdAt: timestamp('created_at')
    .defaultNow(),

  updatedAt: timestamp('updated_at')
    .defaultNow(),
});