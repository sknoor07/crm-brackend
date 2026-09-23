import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { invoices } from '../../db/schema/invoices.js';
import { eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { jobs } from '../../db/schema/jobs.js';
import { customerProfiles, users } from '../../db/schema/users.js';
import { invoiceItems } from '../../db/schema/invoice-items.js';
import { jobItems } from '../../db/schema/job-items.js';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const signaturePath = path.join(__dirname, 'assets', 'signature.png');
const stampPath = path.join(__dirname, 'assets', 'stamp.png');
/** Convert an image file to a base64 data URI (works with page.setContent) */
const imageToDataUri = async (filePath) => {
    const buffer = await fs.readFile(filePath);
    const ext = path.extname(filePath).slice(1).toLowerCase(); // 'png'
    const mime = ext === 'png' ? 'image/png' : `image/${ext}`;
    return `data:${mime};base64,${buffer.toString('base64')}`;
};
const templatePath = path.join(process.cwd(), 'src', 'modules', 'invoice', 'invoice-template.html');
const escapeHtml = (value) => {
    if (!value) {
        return '';
    }
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
};
const formatMoney = (value) => {
    return Number(value).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
};
const formatDate = (value) => {
    return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(new Date(value));
};
const buildItemsHtml = (items, currency, hasGst) => {
    return items
        .map((item) => {
        const componentRows = item.components
            .map((component) => `
              <tr>
                <td>
                  ${escapeHtml(component.name)}
                </td>

                ${hasGst
            ? '<td class="text-center">84733030</td>' // Hardcoded HSN
            : ''}

                <td class="text-center">
                  ${component.quantity}
                </td>

                <td class="text-right">
                  ${currency}
                  ${formatMoney(component.unitPrice)}
                </td>

                <td class="text-right">
                  ${currency}
                  ${formatMoney(component.lineTotal)}
                </td>

                <td class="text-center warranty">
                  ${component.warrantyMonths > 0
            ? `${component.warrantyMonths} months`
            : 'No warranty'}
                </td>
              </tr>
            `)
            .join('');
        return `
        <div class="device">
          <div class="device-header">
            ${escapeHtml(item.deviceName)}
          </div>

          <div class="device-details">
            <strong>Category:</strong>
            ${escapeHtml(item.deviceCategory)}
            <br>
            <strong>Serial Number:</strong>
            ${escapeHtml(item.serialNumber) || 'N/A'}
          </div>

          <table>
            <thead>
              <tr>
                <th>Component</th>
                ${hasGst ? '<th class="text-center">HSN / SAC</th>' : ''}
                <th class="text-center">Qty</th>
                <th class="text-right">Unit Price</th>
                <th class="text-right">Total</th>
                <th class="text-center">Warranty</th>
              </tr>
            </thead>
            <tbody>
              ${componentRows}
            </tbody>
          </table>
        </div>
      `;
    })
        .join('');
};
export const generateInvoicePdf = async (data) => {
    // -----------------------------------------------
    // 1. Read HTML template
    // -----------------------------------------------
    let html = await fs.readFile(templatePath, 'utf-8');
    // Determine if GST should be shown
    const hasGst = data.cgst !== null || data.sgst !== null || data.igst !== null;
    const gstRows = `
    ${data.cgst !== null ? `
      <div class="summary-row">
        <span>CGST</span>
        <span>${escapeHtml(data.currency)} ${formatMoney(data.cgst)}</span>
      </div>
    ` : ''}
    ${data.sgst !== null ? `
      <div class="summary-row">
        <span>SGST</span>
        <span>${escapeHtml(data.currency)} ${formatMoney(data.sgst)}</span>
      </div>
    ` : ''}
    ${data.igst !== null ? `
      <div class="summary-row">
        <span>IGST</span>
        <span>${escapeHtml(data.currency)} ${formatMoney(data.igst)}</span>
      </div>
    ` : ''}
  `;
    // -----------------------------------------------
    // 2. Generate components HTML
    // -----------------------------------------------
    const itemsHtml = buildItemsHtml(data.items, data.currency, hasGst);
    const signatureSrc = await imageToDataUri(signaturePath);
    const stampSrc = await imageToDataUri(stampPath);
    // -----------------------------------------------
    // 3. Replace template variables
    // -----------------------------------------------
    const replacements = {
        '{{invoiceNumber}}': escapeHtml(data.invoiceNumber),
        '{{invoiceDate}}': formatDate(data.invoiceDate),
        '{{jobNumber}}': escapeHtml(data.job.jobNumber),
        '{{customerName}}': escapeHtml(data.customer.name),
        '{{customerEmail}}': escapeHtml(data.customer.email),
        '{{customerPhone}}': escapeHtml(data.customer.phone),
        '{{billingAddress}}': escapeHtml(data.customer.billingAddress),
        '{{currency}}': escapeHtml(data.currency),
        '{{items}}': itemsHtml,
        '{{subtotal}}': formatMoney(data.subtotal),
        '{{serviceCharge}}': formatMoney(data.serviceCharge),
        '{{discount}}': formatMoney(data.discount),
        '{{totalAmount}}': formatMoney(data.totalAmount),
        // Hardcoded Invoice Copy Label
        '{{invoiceCopyLabel}}': '<div class="copy-label">ORIGINAL FOR RECIPIENT</div>',
        // Hardcoded Signature Block
        '{{signatureBlock}}': `
  <div class="signature-section">
    <div class="signature-box">
      <div class="signature-visual">
        <img class="signature-stamp" src="${stampSrc}" alt="Company stamp" />
        <div class="signature-sign-wrap">
          <img class="signature-sign" src="${signatureSrc}" alt="Authorized signature" />
          <div class="signature-line"></div>
        </div>
      </div>
      <div class="signature-label">Authorized Signatory</div>
      <div class="signature-company">
        For <strong>Crestwave Technology Pvt Ltd</strong>
      </div>
    </div>
  </div>
    `,
        // Conditional GST Blocks
        '{{companyRegistrations}}': hasGst ? `
      <div class="company-registrations">
        <strong>GSTIN:</strong> 27AANCC4730D1ZS <br>
        <strong>CIN:</strong> U62011MH2026PTC465665
      </div>
    ` : '',
        '{{customerGstinHtml}}': (hasGst && data.customer.gstin) ? `
      <br><strong>GSTIN:</strong> ${escapeHtml(data.customer.gstin)}
    ` : '',
        '{{gstRows}}': gstRows,
    };
    for (const [placeholder, value] of Object.entries(replacements)) {
        html = html.replaceAll(placeholder, value);
    }
    // -----------------------------------------------
    // 4. Start Puppeteer
    // -----------------------------------------------
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
        const page = await browser.newPage();
        // ---------------------------------------------
        // 5. Load HTML
        // ---------------------------------------------
        await page.setContent(html, { waitUntil: 'load' });
        // ---------------------------------------------
        // 6. Generate PDF
        // ---------------------------------------------
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '6mm',
                right: '10mm',
                bottom: '6mm',
                left: '10mm',
            },
        });
        // ---------------------------------------------
        // 7. Return PDF buffer
        // ---------------------------------------------
        return Buffer.from(pdfBuffer);
    }
    finally {
        await browser.close();
    }
};
export const getInvoicePdfData = async (invoiceId) => {
    // -----------------------------------------------
    // 1. Find invoice
    // -----------------------------------------------
    const [invoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);
    if (!invoice)
        throw new Error('Invoice not found');
    // -----------------------------------------------
    // 2. Find job
    // -----------------------------------------------
    const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, invoice.jobId))
        .limit(1);
    if (!job)
        throw new Error('Job not found for invoice');
    // -----------------------------------------------
    // 3. Find customer
    // -----------------------------------------------
    const [customer] = await db
        .select({
        email: users.email,
        phone: users.phone,
        firstName: customerProfiles.firstName,
        lastName: customerProfiles.lastName,
        billingAddress: customerProfiles.billingAddress,
        gstin: customerProfiles.gstin,
    })
        .from(users)
        .leftJoin(customerProfiles, eq(customerProfiles.userId, users.id))
        .where(eq(users.id, invoice.customerId))
        .limit(1);
    if (!customer)
        throw new Error('Customer not found for invoice');
    // -----------------------------------------------
    // 4. Find invoice items + job items
    // -----------------------------------------------
    const rows = await db
        .select({
        invoiceItem: invoiceItems,
        jobItem: jobItems,
    })
        .from(invoiceItems)
        .innerJoin(jobItems, eq(invoiceItems.jobItemId, jobItems.id))
        .where(eq(invoiceItems.invoiceId, invoice.id));
    // -----------------------------------------------
    // 5. Group invoice items by job item
    // -----------------------------------------------
    const groupedItems = new Map();
    for (const row of rows) {
        const jobItem = row.jobItem;
        const invoiceItem = row.invoiceItem;
        if (!groupedItems.has(jobItem.id)) {
            groupedItems.set(jobItem.id, {
                deviceName: jobItem.deviceName,
                deviceCategory: jobItem.deviceCategory,
                serialNumber: jobItem.deviceSerialNumber,
                components: [],
            });
        }
        groupedItems.get(jobItem.id).components.push({
            name: invoiceItem.name,
            quantity: invoiceItem.quantity,
            unitPrice: invoiceItem.unitPrice,
            lineTotal: invoiceItem.lineTotal,
            warrantyMonths: invoiceItem.warrantyMonths,
        });
    }
    // -----------------------------------------------
    // 6. Return PDF-ready data
    // -----------------------------------------------
    return {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.createdAt
            ? invoice.createdAt.toISOString()
            : new Date().toISOString(),
        customer: {
            name: `${customer.firstName} ${customer.lastName}`,
            email: customer.email,
            phone: customer.phone,
            billingAddress: customer.billingAddress,
            gstin: customer.gstin ?? "",
        },
        job: { jobNumber: job.jobNumber },
        items: Array.from(groupedItems.values()),
        subtotal: invoice.subtotal,
        serviceCharge: invoice.serviceCharge,
        discount: invoice.discount,
        cgst: invoice.cgst,
        sgst: invoice.sgst,
        igst: invoice.igst,
        gstType: invoice.gstType,
        totalAmount: invoice.totalAmount,
        currency: invoice.currency,
    };
};
