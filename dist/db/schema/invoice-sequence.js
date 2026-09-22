import { pgSequence } from 'drizzle-orm/pg-core';
export const invoiceNumberSequence = pgSequence('invoice_number_sequence');
