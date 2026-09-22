import { and, desc, eq, sql } from 'drizzle-orm';



import { jobs } from '../../db/schema/jobs.js';
import { jobQuotes } from '../../db/schema/job_quotes.js';
import { jobItemQuotes } from '../../db/schema/job-item-quotes.js';
import { jobItemQuoteLines } from '../../db/schema/job-item-quote-lines.js';

import { invoices } from '../../db/schema/invoices.js';
import { invoiceItems } from '../../db/schema/invoice-items.js';
import { db } from '../../config/database.js';
import { getInvoicePdfData } from './invoice.controller.js';
import { generateInvoicePdf } from './invoice-pdf.service.js';
import { uploadPdf } from '../storage/storage.service.js';
type DbTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];


const generateInvoiceNumber = async (
  tx: DbTransaction,
) => {
  const result = await tx.execute(
    sql`
      SELECT nextval(
        'invoice_number_sequence'
      ) AS sequence_number
    `,
  );

  const sequenceNumber =
    Number(result.rows[0]?.sequence_number);

  const year = new Date()
    .getFullYear();

  return `INV-${year}-${String(sequenceNumber).padStart(6, '0')}`;
};

export const createInvoiceForJob = async (
  jobId: string,
) => {
  return await db.transaction(async (tx) => {
    // --------------------------------------------------
    // 1. Find job
    // --------------------------------------------------

    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (!job) {
      throw new Error('Job not found');
    }

    // --------------------------------------------------
    // 2. Check existing invoice
    // --------------------------------------------------

    const [existingInvoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.jobId, jobId))
      .limit(1);

    if (existingInvoice) {
      return existingInvoice;
    }

    // --------------------------------------------------
    // 3. Find final quote
    // --------------------------------------------------

    const [finalQuote] = await tx
      .select()
      .from(jobQuotes)
      .where(
        and(
          eq(jobQuotes.jobId, jobId),
          eq(jobQuotes.status, 'final'),
        ),
      )
      .orderBy(desc(jobQuotes.version))
      .limit(1);

    if (!finalQuote) {
      throw new Error(
        'Final quote not found for this job',
      );
    }

    // --------------------------------------------------
    // 4. Generate invoice number
    // --------------------------------------------------

    const invoiceNumber =
      await generateInvoiceNumber(tx);

    // --------------------------------------------------
    // 5. Create invoice
    // --------------------------------------------------

    const [invoice] = await tx
      .insert(invoices)
      .values({
        invoiceNumber,

        jobId: job.id,

        customerId: job.customerId,

        quoteId: finalQuote.id,

        subtotal: finalQuote.subtotal,

        serviceCharge: finalQuote.serviceCharge,

        discount: finalQuote.discount,

        cgst: finalQuote.cgst,
        sgst: finalQuote.sgst,

        totalAmount: finalQuote.totalAmount,

        currency: 'INR',

        status: 'pending',

        templateVersion: 1,
      })
      .returning();

    // --------------------------------------------------
    // 6. Get item quotes
    // --------------------------------------------------

    const itemQuotes = await tx
      .select()
      .from(jobItemQuotes)
      .where(
        eq(
          jobItemQuotes.jobQuoteId,
          finalQuote.id,
        ),
      );

    // --------------------------------------------------
    // 7. Get all quote lines
    // --------------------------------------------------

    for (const itemQuote of itemQuotes) {
      const lines = await tx
        .select()
        .from(jobItemQuoteLines)
        .where(
          eq(
            jobItemQuoteLines.quoteId,
            itemQuote.id,
          ),
        );

      if (lines.length === 0) {
        continue;
      }

      await tx
        .insert(invoiceItems)
        .values(
          lines.map((line) => ({
            invoiceId: invoice.id,

            jobItemId:
              itemQuote.jobItemId,

            name: line.name,

            quantity: line.quantity,

            unitPrice: line.unitPrice,

            lineTotal: line.lineTotal,

            warrantyMonths:
              line.warrantyMonths,

            sortOrder:
              line.sortOrder,
          })),
        );
    }

    // --------------------------------------------------
    // 8. Return invoice
    // --------------------------------------------------

    return invoice;
  });
};

export const generateAndStoreInvoicePdf = async (
  invoiceId: string,
) => {
  // -----------------------------------------------
  // 1. Get invoice data
  // -----------------------------------------------

  const data =
    await getInvoicePdfData(invoiceId);

  // -----------------------------------------------
  // 2. Generate PDF
  // -----------------------------------------------

  const pdfBuffer =
    await generateInvoicePdf(data);

  // -----------------------------------------------
  // 3. Create storage key
  // -----------------------------------------------

  const fileName =
    `${data.invoiceNumber}.pdf`;

  const storageKey = fileName;

  // -----------------------------------------------
  // 4. Upload to Neon Object Storage
  // -----------------------------------------------

  await uploadPdf(
    storageKey,
    pdfBuffer,
  );

  // -----------------------------------------------
  // 5. Update invoice
  // -----------------------------------------------

  const [updatedInvoice] =
    await db
      .update(invoices)
      .set({
        status: 'generated',

        pdfStorageKey:
          storageKey,

        pdfFileName:
          fileName,

        pdfGeneratedAt:
          new Date(),

        updatedAt:
          new Date(),
      })
      .where(
        eq(
          invoices.id,
          invoiceId,
        ),
      )
      .returning();

  return updatedInvoice;
};
