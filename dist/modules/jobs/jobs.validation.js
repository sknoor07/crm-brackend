import { z } from 'zod';
import { estimatedComponentSchema } from '../customerService/cs.validation.js';
import { createSelectSchema } from "drizzle-zod";
import { jobs } from '../../db/schema/jobs.js';
import { jobItems } from '../../db/schema/job-items.js';
export const createJobSchema = z.object({
    // Customer details
    customerEmail: z
        .string()
        .email('Valid customer email is required'),
    customerPhone: z
        .string()
        .trim()
        .min(1, 'Customer phone is required'),
    customerFirstName: z
        .string()
        .trim()
        .min(1, 'Customer first name is required'),
    customerLastName: z
        .string()
        .trim()
        .min(1, 'Customer last name is required'),
    billingAddress: z
        .string()
        .trim()
        .min(1, 'Customer address is required'),
    // Job item details
    deviceCategory: z
        .string()
        .trim()
        .min(1, 'Device category is required'),
    deviceSerialNumber: z
        .string()
        .trim()
        .optional(),
    issueDescription: z
        .string()
        .trim()
        .min(5, 'Issue description must be at least 5 characters'),
    estimatedComponentsCost: z
        .number()
        .nonnegative('Estimated components cost must be 0 or greater')
        .optional(),
    estimatedComponents: z
        .array(estimatedComponentSchema)
        .min(1, 'Provide at least one estimated component')
        .optional(),
    // Mandatory CS comment when creating the job
    comment: z
        .string()
        .trim()
        .min(1, 'Comment is required')
        .max(2000, 'Comment cannot exceed 2000 characters'),
}).superRefine((data, ctx) => {
    if (data.estimatedComponents == null &&
        data.estimatedComponentsCost == null) {
        ctx.addIssue({
            code: 'custom',
            message: 'Provide estimatedComponents or estimatedComponentsCost',
            path: ['estimatedComponents'],
        });
    }
});
export const jobSchema = z.object({
    id: z.string().uuid(),
    jobNumber: z.string(),
    customerId: z.string().uuid(),
    currentStatus: z.string(),
    paymentConfirmed: z.boolean(),
});
export const jobItemSchema = z.object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    deviceName: z.string(),
    deviceCategory: z.string(),
    deviceSerialNumber: z.string().nullable(),
    issueDescription: z.string(),
    repairLocation: z.enum(["customer_site", "inlab"]).nullable(),
    currentStatus: z.string(),
    assignedRepairPersonId: z.string().uuid().nullable(),
    requestedComponents: z.unknown().nullable(),
    diagnosisNotes: z.string().nullable(),
    repairNotes: z.string().nullable(),
    isWarrantyClaim: z.boolean(),
    estimatedComponentsCost: z.string().nullable(),
    finalComponentsCost: z.string().nullable(),
    baseRepairCost: z.string().nullable(),
    serviceChargeApplied: z.string().nullable(),
});
export const getJobWithItemsQuerySchema = z.object({
    page: z.coerce
        .number()
        .int()
        .min(1)
        .optional()
        .default(1),
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20),
    search: z.string()
        .trim()
        .optional()
        .default(""),
});
const baseJobSchema = createSelectSchema(jobs);
const baseJobItemSchema = createSelectSchema(jobItems);
export const mappedCustomerSchema = z.object({
    firstName: z.string(),
    lastName: z.string(),
    phone: z.string(),
    email: z.string(),
    billingAddress: z.string().nullable().optional(),
    gstin: z.string().nullable().optional(),
});
// 3. Define the pagination schema
export const paginationSchema = z.object({
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(), // Note: kept your original spelling from the controller
});
// 4. Combine them into the final Response Schema
export const getJobWithItemsResponseSchema = z.object({
    message: z.string(),
    result: z.array(z.object({
        job: baseJobSchema,
        customer: mappedCustomerSchema,
        jobItems: z.array(baseJobItemSchema),
    })),
    pagination: paginationSchema,
});
