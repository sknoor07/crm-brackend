import { z } from 'zod';

export const assignTechnicianSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  technicianId: z.string().uuid("Invalid technician ID format"),
});

export type AssignTechnicianInput = z.infer<typeof assignTechnicianSchema>;

export const receiveLabSchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
});

export type ReceiveLabInput = z.infer<typeof receiveLabSchema>;

export const assignDeliverySchema = z.object({
  jobId: z.string().uuid("Invalid job ID format"),
  technicianId: z.string().uuid("Invalid technician ID format"),
});