import { pgTable, uuid, decimal, timestamp, integer, varchar, } from 'drizzle-orm/pg-core';
import { invoices } from './invoices.js';
import { jobItems } from './job-items.js';
export const invoiceItems = pgTable('invoice_items', {
    id: uuid('id')
        .defaultRandom()
        .primaryKey(),
    invoiceId: uuid('invoice_id')
        .references(() => invoices.id, {
        onDelete: 'cascade',
    })
        .notNull(),
    // The repair item this invoice line belongs to
    jobItemId: uuid('job_item_id')
        .references(() => jobItems.id)
        .notNull(),
    name: varchar('name', {
        length: 200,
    }).notNull(),
    quantity: integer('quantity')
        .notNull()
        .default(1),
    unitPrice: decimal('unit_price', {
        precision: 10,
        scale: 2,
    }).notNull(),
    lineTotal: decimal('line_total', {
        precision: 10,
        scale: 2,
    }).notNull(),
    // Warranty copied from job_item_quote_lines
    warrantyMonths: integer('warranty_months')
        .notNull()
        .default(0),
    sortOrder: integer('sort_order')
        .notNull()
        .default(0),
    createdAt: timestamp('created_at')
        .defaultNow()
        .notNull(),
});
