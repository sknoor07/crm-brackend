import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';

import { users } from './users.js';
export const otpVerifications = pgTable('otp_verifications', {
  id: uuid('id').defaultRandom().primaryKey(),

  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),

  otpHash: varchar('otp_hash', { length: 255 }).notNull(),

  purpose: varchar('purpose', { length: 50 }).notNull(),

  channel: varchar('channel', { length: 20 }).notNull(),

  destination: varchar('destination', { length: 255 }).notNull(),

  expiresAt: timestamp('expires_at').notNull(),

  attempts: integer('attempts').default(0).notNull(),

  verifiedAt: timestamp('verified_at'),

  createdAt: timestamp('created_at').defaultNow(),
});
