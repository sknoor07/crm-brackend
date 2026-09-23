import {
  pgEnum,
  pgTable,
  uuid,
  decimal,
  timestamp,
  varchar,
  integer,
  unique,
} from 'drizzle-orm/pg-core';

import { jobs } from './jobs.js';
import { users } from './users.js';
import { jobQuotes } from './job_quotes.js';
import { gstType } from './gst.js';

export const invoiceStatus = pgEnum(
  'invoice_status',
  [
    'pending',
    'generated',
    'failed',
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id')
      .defaultRandom()
      .primaryKey(),

    invoiceNumber: varchar('invoice_number', {
      length: 50,
    })
      .notNull()
      .unique(),

    jobId: uuid('job_id')
      .references(() => jobs.id)
      .notNull(),

    customerId: uuid('customer_id')
      .references(() => users.id)
      .notNull(),

    // Exact quote from which this invoice was generated
    quoteId: uuid('quote_id')
      .references(() => jobQuotes.id)
      .notNull(),

    subtotal: decimal('subtotal', {
      precision: 10,
      scale: 2,
    }).notNull(),

    serviceCharge: decimal('service_charge', {
      precision: 10,
      scale: 2,
    }).notNull(),

    discount: decimal('discount', {
      precision: 10,
      scale: 2,
    }).notNull(),

    cgst: decimal('cgst', {
      precision: 10,
      scale: 2,
    }),

    sgst: decimal('sgst', {
      precision: 10,
      scale: 2,
    }),

    igst: decimal('igst', {
      precision: 10,
      scale: 2,
    }),

    gstType: gstType('gst_type')
      .notNull()
      .default('none'),

    totalAmount: decimal('total_amount', {
      precision: 10,
      scale: 2,
    }).notNull(),

    currency: varchar('currency', {
      length: 10,
    })
      .notNull()
      .default('INR'),

    status: invoiceStatus('status')
      .notNull()
      .default('pending'),

    // Local disk path for now.
    // Later this can contain the S3 object key.
    pdfStorageKey: varchar('pdf_storage_key', {
      length: 500,
    }),

    pdfFileName: varchar('pdf_file_name', {
      length: 255,
    }),

    // Allows us to keep old invoices unchanged
    // when the invoice HTML design changes.
    templateVersion: integer('template_version')
      .notNull()
      .default(1),

    pdfGeneratedAt: timestamp('pdf_generated_at'),

    createdAt: timestamp('created_at')
      .defaultNow()
      .notNull(),

    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    oneInvoicePerJob: unique().on(table.jobId),
  }),
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;