import {
  pgTable,
  uuid,
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),

  name: varchar('name', {length: 50,}).notNull().unique(),

  managerId: uuid('manager_id').references(() => users.id),

  createdAt: timestamp('created_at').defaultNow(),
});