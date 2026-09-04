import { pgEnum, pgTable, uuid, varchar, text, timestamp, decimal, boolean } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { warranties } from './warranties.js';

export const jobStatusValues = [
  'pending_cs_verification',
  'ready_for_pickup',
  'pending_pickup',
  'pending_final_quote',
  'awaiting_customer_approval',
  'repair_in_progress',
  'in_transit_to_lab',
  'arrived_at_lab',
  'in_lab_diagnosis',
  'repair_completed',
  'out_for_delivery',
  'delivered',
  'closed',
  'repair_rejected',
  'cancelled',
] as const;

export const jobStatus = pgEnum('job_status', jobStatusValues);
export type JobStatus = (typeof jobStatusValues)[number];

export const deviceServiceCharges = pgTable('device_service_charges', {
  id: uuid('id').defaultRandom().primaryKey(),
  deviceCategory: varchar('device_category', { length: 100 }).notNull().unique(), 
  chargeAmount: decimal('charge_amount', { precision: 10, scale: 2 }).notNull(),  
  createdAt: timestamp('created_at').defaultNow(),
});

export const jobs = pgTable('jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobNumber: varchar('job_number', { length: 36 }).notNull().unique(),
  customerId: uuid('customer_id').references(() => users.id).notNull(),
  
  // Links to the device service charge table to know what type of device it is
  deviceCategory: varchar('device_category', { length: 100 }).references(() => deviceServiceCharges.deviceCategory),
  
  issueDescription: text('issue_description').notNull(),
  currentStatus: jobStatus('current_status').notNull().default('pending_cs_verification'),
  repairLocation: varchar('repair_location', { length: 20 }),
  
  // Quoting Fields
  estimatedComponentsCost: decimal('estimated_components_cost', { precision: 10, scale: 2 }),
  finalComponentsCost: decimal('final_components_cost', { precision: 10, scale: 2 }),
  serviceChargeApplied: decimal('service_charge_applied', { precision: 10, scale: 2 }),
  isFinalQuoteApproved: boolean('is_final_quote_approved').default(false),
  
  // Routing assignments
  transportManagerId: uuid('transport_manager_id').references(() => users.id),
  repairManagerId: uuid('repair_manager_id').references(() => users.id),
  assignedPickupTechId: uuid('assigned_pickup_tech_id').references(() => users.id),
  assignedDeliveryTechId: uuid('assigned_delivery_tech_id').references(() => users.id),
  assignedRepairTechId: uuid('assigned_repair_tech_id').references(() => users.id),
  requestedComponents: text('requested_components'),
  technicianNotes: text('technician_notes'),
  //warranty and service details
  // Add to existing jobs table:
warrantyId: uuid('warranty_id').references(() => warranties.id),
originalJobId: uuid('original_job_id'), // For repeat/warranty jobs
deviceSerialNumber: varchar('device_serial_number', { length: 50 }),
issueCategory: varchar('issue_category', { length: 50 }), // e.g., 'display', 'motherboard', etc.
isWarrantyClaim: boolean('is_warranty_claim').default(false),
baseRepairCost: decimal('base_repair_cost', { precision: 10, scale: 2 }),
  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});


export const jobComments = pgTable('job_comments', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(), // Who made the comment
  comment: text('comment').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const jobStatusHistory = pgTable('job_status_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  previousStatus: jobStatus('previous_status'),
  newStatus: jobStatus('new_status').notNull(),
  changedBy: uuid('changed_by').references(() => users.id),
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow(),
});