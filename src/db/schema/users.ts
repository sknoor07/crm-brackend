import { pgTable, uuid, varchar, text, jsonb, boolean, timestamp, date } from 'drizzle-orm/pg-core';

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  description: text('description'),
  permissions: jsonb('permissions'),
  createdAt: timestamp('created_at').defaultNow(),
});

/**
 * 1. BASE AUTH TABLE
 * Strictly for logging in. Contains absolutely zero sensitive HR data.
 */
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  userType: varchar('user_type', { length: 20 }).notNull().default('customer'), // 'employee' or 'customer'
  phone: varchar('phone', { length: 20 }),
  isActive: boolean('is_active').default(true),
  mustChangePassword: boolean('must_change_password').default(false),
  
  createdAt: timestamp('created_at').defaultNow(),

  updatedAt: timestamp('updated_at').defaultNow(),
});

/**
 * 2. EMPLOYEE PROFILES (COMPLIANCE TABLE)
 * Strictly isolated for company staff. Contains all statutory and HR data.
 */
export const employeeProfiles = pgTable('employee_profiles', {
  userId: uuid('user_id').references(() => users.id).primaryKey(), // 1-to-1 relationship with users
  
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  
  // Statutory Details
  dateOfBirth: date('date_of_birth'),
  aadhaarNumber: varchar('aadhaar_number', { length: 12 }).unique(),
  panNumber: varchar('pan_number', { length: 10 }).unique(),
  uanNumber: varchar('uan_number', { length: 12 }), 
  
  // Addresses
  currentAddress: text('current_address'),
  permanentAddress: text('permanent_address'),
  
  // Bank Info for Payroll
  bankAccountNumber: varchar('bank_account_number', { length: 50 }),
  bankIfscCode: varchar('bank_ifsc_code', { length: 20 }),
  bankName: varchar('bank_name', { length: 100 }),

  emergencyContactName: varchar('emergency_contact_name', { length: 100 }),
  emergencyContactPhone: varchar('emergency_contact_phone', { length: 20 }),

  // Work Data
  specializations: jsonb('specializations').default('[]'), 
});

/**
 * 3. CUSTOMER PROFILES
 * Lightweight table for customer CRM data. No HR fields included.
 */
export const customerProfiles = pgTable('customer_profiles', {
  userId: uuid('user_id').references(() => users.id).primaryKey(),
  
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  phone: varchar('phone', { length: 20 }),
  billingAddress: text('billing_address'),
});

/**
 * REFRESH TOKENS TABLE (SESSION MANAGEMENT)
 * Stores active sessions. Expires in 14 days. Allows revoking on logout.
 */
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  isRevoked: boolean('is_revoked').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const accountInvitations = pgTable('account_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  createdAt: timestamp('created_at').defaultNow(),
});