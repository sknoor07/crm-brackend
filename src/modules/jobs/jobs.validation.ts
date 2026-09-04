import { z } from 'zod';

export const createJobSchema = z.object({
  // Customer details (used to find or auto-create the guest account)
  customerEmail: z.string().email("Valid customer email is required"),
  customerPhone: z.string().trim().min(1, "Customer phone is required"),
  customerFirstName: z.string().min(1, "Customer first name is required"),
  customerLastName: z.string().min(1, "Customer last name is required"),
  billingAddress: z.string().trim().min(1, "Customer address is required"),
  // Job details
  deviceCategory: z.string().min(1, "Device category is required (e.g., macbook, windows_laptop, ios_phone)"),
  issueDescription: z.string().min(5, "Issue description must be at least 5 characters"),
  estimatedComponentsCost: z.number().positive("Estimated components cost must be greater than zero"),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;