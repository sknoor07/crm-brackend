import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer';
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
const buildItemsHtml = (items, currency) => {
    return items
        .map((item) => {
        const componentRows = item.components
            .map((component) => `
              <tr>
                <td>
                  ${escapeHtml(component.name)}
                </td>

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
            ${escapeHtml(item.serialNumber)
            || 'N/A'}
          </div>

          <table>

            <thead>
              <tr>
                <th>Component</th>

                <th class="text-center">
                  Qty
                </th>

                <th class="text-right">
                  Unit Price
                </th>

                <th class="text-right">
                  Total
                </th>

                <th class="text-center">
                  Warranty
                </th>
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
    // -----------------------------------------------
    // 2. Generate components HTML
    // -----------------------------------------------
    const itemsHtml = buildItemsHtml(data.items, data.currency);
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
        '{{cgst}}': data.cgst !== null
            ? formatMoney(data.cgst)
            : '',
        '{{sgst}}': data.sgst !== null
            ? formatMoney(data.sgst)
            : '',
        '{{totalAmount}}': formatMoney(data.totalAmount),
    };
    for (const [placeholder, value] of Object.entries(replacements)) {
        html = html.replaceAll(placeholder, value);
    }
    // -----------------------------------------------
    // 4. Start Puppeteer
    // -----------------------------------------------
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
        ],
    });
    try {
        const page = await browser.newPage();
        // ---------------------------------------------
        // 5. Load HTML
        // ---------------------------------------------
        await page.setContent(html, {
            waitUntil: 'load',
        });
        // ---------------------------------------------
        // 6. Generate PDF
        // ---------------------------------------------
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: {
                top: '15mm',
                right: '15mm',
                bottom: '15mm',
                left: '15mm',
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
