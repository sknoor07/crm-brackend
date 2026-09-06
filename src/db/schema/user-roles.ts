import {
  pgTable,
  uuid,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';
import { roles } from './roles.js';

export const userRoles = pgTable('user_roles',{
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id').references(() => users.id).notNull(),

    roleId: uuid('role_id').references(() => roles.id).notNull(),

    assignedBy: uuid('assigned_by').references(() => users.id),

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    userRoleUnique: unique().on(
      table.userId,
      table.roleId,
    ),
  }),
);