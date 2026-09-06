import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),

  name: varchar('name', {length: 50,}).notNull().unique(),

  description: text('description'),

  permissions: jsonb('permissions'),

  createdAt: timestamp('created_at').defaultNow(),
});