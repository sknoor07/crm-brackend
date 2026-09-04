import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { roles, users } from './users.js'; // Note the .js extension for ES Modules

export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(), // e.g., 'Repair', 'Transport'
  managerId: uuid('manager_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userRoles = pgTable('user_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  roleId: uuid('role_id').references(() => roles.id).notNull(),
  assignedBy: uuid('assigned_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});