import { z } from 'zod';

export const assignLabTechSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  labTechId: z.string().uuid("Invalid lab technician ID format"),
});

export type AssignLabTechInput = z.infer<typeof assignLabTechSchema>;

export const requestLabQuoteSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  requestedComponents: z.string().min(1, "Please specify the names of the components needed"),
  technicianNotes: z.string().optional(),
});

export type RequestLabQuoteInput = z.infer<typeof requestLabQuoteSchema>;

export const completeRepairSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  repairNotes: z.string().optional(),
});

export type CompleteRepairInput = z.infer<typeof completeRepairSchema>;