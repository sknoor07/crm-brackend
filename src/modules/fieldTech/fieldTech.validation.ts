import { z } from 'zod';

export const updateTransitSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
});

export const requestQuoteSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  requestedComponents: z.string().min(1, "Please specify the names of the components needed"),
  additionalNotes: z.string().optional(),
});

export const confirmDeliverySchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  deliveryNotes: z.string().optional(),
});

export const completeRepairSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  repairNotes: z.string().optional(),
});

export type CompleteRepairInput = z.infer<typeof completeRepairSchema>;