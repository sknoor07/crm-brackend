import { z } from 'zod';
const invoiceStatusEnum = ["pending", "generated", "failed"];
export const customerRegistrationSchema = z.object({
    firstName: z.string().min(1, 'frist name cannnot be empty').max(200, 'max limit reached'),
    lastName: z.string().min(1).max(200, 'max character limit reached'),
    phoneNumber: z.string().min(10, 'phone number too short').max(11, 'phone number too long'),
    email: z.email('Invalid email Id Format'),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
}).superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
        ctx.addIssue({
            code: "custom",
            message: "The passwords did not match",
            path: ['confirmPassword']
        });
    }
});
export const quoteResponseSchema = z.object({
    jobId: z.string().uuid('Invalid job item ID format'),
    decision: z.enum(['accept', 'reject'], {
        message: "Decision must be either 'accept' or 'reject'",
    }),
    // Customer comments are optional.
    comment: z
        .string()
        .trim()
        .max(2000, 'Comment cannot exceed 2000 characters')
        .optional(),
});
export const createCustomerJobItemSchema = z.object({
    deviceName: z.string().min(1, 'device name is required').max(100, 'device name connot be more than 100 characters'),
    deviceCategory: z.string().min(1, 'Device Category is Required'),
    deviceSerialNumber: z.string().min(1, 'Serial Number is required'),
    issueDescription: z.string().min(5, 'Issue description must be at least 5 characters'),
    comment: z.string().optional(),
});
export const createCustomerJobSchema = z.object({
    items: z
        .array(createCustomerJobItemSchema)
        .min(1, 'At least one job item is required'),
    comment: z
        .string()
        .trim()
        .optional(),
});
export const customerJobItemSchema = z.object({
    id: z.string().uuid(),
    deviceName: z.string(),
    deviceCategory: z.string(),
    deviceSerialNumber: z.string().nullable(),
    issueDescription: z.string(),
    issueCategory: z.string().nullable(),
    repairLocation: z.string(),
    estimatedComponentsCost: z.string().nullable(),
    finalComponentsCost: z.string().nullable(),
    serviceChargeApplied: z.string().nullable(),
    isFinalQuoteApproved: z.boolean(),
    baseRepairCost: z.string().nullable(),
    createdAt: z.date().nullable(),
});
const invoiceStatus = z.enum(invoiceStatusEnum);
export const InvoiceSchema = z.object({
    id: z.string().uuid(),
    invoiceNumber: z.string(),
    status: invoiceStatus,
    pdfFileName: z.string().nullable(),
});
export const customerJobSchema = z.object({
    id: z.string().uuid(),
    jobNumber: z.string(),
    currentStatus: z.string(),
    paymentConfirmed: z.boolean().nullable(),
    createdAt: z.date().nullable(),
    invoice: InvoiceSchema.nullable(),
    items: z.array(customerJobItemSchema),
});
export const customerJobsSchema = z.array(customerJobSchema);
export const gstinSchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Invalid GSTIN format");
export const customerProfile = z.object({
    firstName: z.string().min(1, 'frist name cannnot be empty').max(200, 'max limit reached'),
    lastName: z.string().min(1).max(200, 'max character limit reached'),
    phoneNumber: z.string().min(10, 'phone number too short').max(11, 'phone number too long'),
    email: z.email('Invalid email Id Format'),
    gstin: gstinSchema.optional().or(z.literal("")),
    billingAddress: z.string().max(20000, 'address cannot be this long'),
});
export const passwordSchema = z.object({
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
}).superRefine(({ confirmPassword, password }, ctx) => {
    if (confirmPassword !== password) {
        ctx.addIssue({
            code: "custom",
            message: "The passwords did not match",
            path: ['confirmPassword']
        });
    }
});
