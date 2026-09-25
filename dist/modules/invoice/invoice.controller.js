import { eq } from "drizzle-orm";
import { db } from "../../config/database.js";
import { invoices } from "../../db/schema/invoices.js";
import { jobs } from "../../db/schema/jobs.js";
import { customerProfiles, users } from "../../db/schema/users.js";
import { invoiceItems } from "../../db/schema/invoice-items.js";
import { jobItems } from "../../db/schema/job-items.js";
import { createPdfDownloadUrl } from "../storage/storage.service.js";
export const getInvoicePdfData = async (invoiceId) => {
    // -----------------------------------------------
    // 1. Find invoice
    // -----------------------------------------------
    const [invoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);
    if (!invoice) {
        throw new Error('Invoice not found');
    }
    // -----------------------------------------------
    // 2. Find job
    // -----------------------------------------------
    const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, invoice.jobId))
        .limit(1);
    if (!job) {
        throw new Error('Job not found for invoice');
    }
    // -----------------------------------------------
    // 3. Find customer
    // -----------------------------------------------
    const [customer] = await db
        .select({
        email: users.email,
        phone: users.phone,
        firstName: customerProfiles.firstName,
        lastName: customerProfiles.lastName,
        gstin: customerProfiles.gstin,
        billingAddress: customerProfiles.billingAddress,
    })
        .from(users)
        .leftJoin(customerProfiles, eq(customerProfiles.userId, users.id))
        .where(eq(users.id, invoice.customerId))
        .limit(1);
    if (!customer) {
        throw new Error('Customer not found for invoice');
    }
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
        groupedItems
            .get(jobItem.id)
            .components.push({
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
            gstin: customer.gstin,
            phone: customer.phone,
            billingAddress: customer.billingAddress,
        },
        job: {
            jobNumber: job.jobNumber,
        },
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
export const downloadInvoice = async (req, res) => {
    try {
        // --------------------------------------------------
        // AUTHENTICATION
        // --------------------------------------------------
        const userId = req.user?.userId;
        const roleName = req.user?.roles;
        if (!userId) {
            return res.status(401).json({
                status: "error",
                message: "Unauthorized",
            });
        }
        // --------------------------------------------------
        // INVOICE ID
        // --------------------------------------------------
        const { invoiceId } = req.params;
        if (typeof invoiceId !== 'string' ||
            !invoiceId) {
            return res.status(400).json({
                status: 'error',
                message: 'Invoice ID is required.',
            });
        }
        // --------------------------------------------------
        // FIND INVOICE
        // --------------------------------------------------
        const [invoice] = await db
            .select()
            .from(invoices)
            .where(eq(invoices.id, invoiceId))
            .limit(1);
        if (!invoice) {
            return res.status(404).json({
                status: 'error',
                message: 'Invoice not found.',
            });
        }
        // --------------------------------------------------
        // OWNERSHIP CHECK
        // --------------------------------------------------
        const isCustomer = roleName?.some((role) => role === "customer");
        const isCustomerService = roleName?.some((role) => role === 'customer_service');
        if (isCustomer &&
            invoice.customerId !== userId) {
            return res.status(403).json({
                status: "error",
                message: "You are not allowed to access this invoice.",
            });
        }
        // --------------------------------------------------
        // CHECK PDF
        // --------------------------------------------------
        if (invoice.status !== 'generated' ||
            !invoice.pdfStorageKey) {
            return res.status(409).json({
                status: 'error',
                message: 'Invoice PDF is not available yet.',
            });
        }
        // --------------------------------------------------
        // CREATE SIGNED URL
        // --------------------------------------------------
        const url = await createPdfDownloadUrl(invoice.pdfStorageKey);
        // --------------------------------------------------
        // RESPONSE
        // --------------------------------------------------
        return res.status(200).json({
            status: 'success',
            invoice: {
                id: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                fileName: invoice.pdfFileName,
            },
            url,
            expiresIn: 300,
        });
    }
    catch (error) {
        console.error('Download invoice error:', error);
        return res.status(500).json({
            status: 'error',
            message: 'Failed to generate invoice download URL.',
        });
    }
};
