import { z } from "zod";
import { warrantyFailureTypeValues, warrantyIssueCategoryValues } from "../../db/schema/warranty_claims.js";
export const warrantyIdParamSchema = z.object({
    warrantyId: z.string().uuid("Invalid warranty ID"),
});
export const claimIdParamSchema = z.object({
    claimId: z.string().uuid("Invalid claim ID"),
});
export const warrantySearchSchema = z.object({
    status: z
        .enum([
        "active",
        "expired",
        "void",
        "completed",
    ])
        .optional(),
    customerId: z
        .string()
        .uuid("Invalid customer ID")
        .optional(),
    jobId: z
        .string()
        .uuid("Invalid job ID")
        .optional(),
    jobItemId: z
        .string()
        .uuid("Invalid job item ID")
        .optional(),
    deviceSerialNumber: z
        .string()
        .trim()
        .max(50)
        .optional(),
    componentName: z
        .string()
        .trim()
        .max(200)
        .optional(),
    page: z.coerce
        .number()
        .int()
        .positive()
        .default(1),
    limit: z.coerce
        .number()
        .int()
        .positive()
        .max(100)
        .default(20),
});
export const createWarrantyClaimSchema = z.object({
    reasonForReturn: z
        .string()
        .trim()
        .min(3, "Reason for return is required")
        .max(2000),
    issueCategory: z.enum(warrantyIssueCategoryValues),
    notes: z
        .string()
        .trim()
        .max(5000)
        .optional(),
});
export const updateWarrantyClaimInspectionSchema = z.object({
    diagnosis: z
        .string()
        .trim()
        .min(3)
        .max(5000),
    failureType: z.enum(warrantyFailureTypeValues),
    notes: z
        .string()
        .trim()
        .max(5000)
        .optional(),
});
//   One thing to note: failureType is not required when creating the claim.
// That's intentional.
// Customer creates claim
//         ↓
// issueCategory = overheating
// failureType   = null
//         ↓
// Technician inspects
//         ↓
// failureType = component_failure
