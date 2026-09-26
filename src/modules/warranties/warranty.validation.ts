import { z } from "zod";
import { warrantyFailureTypeValues, warrantyIssueCategoryValues } from "../../db/schema/warranty_claims.js";
import { en } from "zod/locales";

export const warrantyIdParamSchema = z.object({
  warrantyId: z.string().uuid("Invalid warranty ID"),
});

export type WarrantyIdParamSchema = z.infer<typeof warrantyIdParamSchema>

export const claimIdParamSchema = z.object({
  claimId: z.string().uuid("Invalid claim ID"),
});

export type ClaimIdParamSchema = z.infer<
  typeof claimIdParamSchema
>;


export const jobIdParamSchema = z.object({
  jobId: z.string().uuid("Invalid Job ID"),
});

export type JobIdParamSchema = z.infer<
  typeof jobIdParamSchema
>

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

export type WarrantySearchInput = z.infer<
  typeof warrantySearchSchema
>;

export const createWarrantyClaimSchema = z.object({
  jobId:z.string().uuid("Invalid Job ID"),
  customerId:z.string().uuid("Invalid Customer id"),
  jobItemId:z.string().uuid("Invalid Item Id"),
  reasonForReturn:z.string().min(6,"Please Enter Atleast 3 words").max(2000,"cannot type more than 2000 characters"),
  issueCategory: z.enum(warrantyIssueCategoryValues),
  notes:z.string().max(2000,"cannot have more than 2000 charcters"),
});

export const updateWarrantyClaimInspectionSchema =
  z.object({
    diagnosis: z
      .string()
      .trim()
      .min(3)
      .max(5000),

    failureType: z.enum(
      warrantyFailureTypeValues,
    ),

    notes: z
      .string()
      .trim()
      .max(5000)
      .optional(),
  });

export type CreateWarrantyClaimInput = z.infer<
  typeof createWarrantyClaimSchema
>;

export type UpdateWarrantyClaimInspectionInput = z.infer<
  typeof updateWarrantyClaimInspectionSchema
>;

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