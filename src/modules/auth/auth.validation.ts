import { z } from 'zod';

// We separate the base auth requirements...
const baseUserSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const passwordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters long"),
});



// ...from the strict Employee compliance requirements
export const registerEmployeeSchema = baseUserSchema.extend({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  phone: z.string().optional(),
  
  dateOfBirth: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: "Invalid date format (YYYY-MM-DD expected)"
  }).optional(),
  
  aadhaarNumber: z.string()
    .length(12, "Aadhaar must be exactly 12 digits")
    .regex(/^\d+$/, "Aadhaar must contain only numbers").optional(),
    
  panNumber: z.string()
    .length(10, "PAN must be exactly 10 characters")
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format").optional(),
    
  uanNumber: z.string()
    .length(12, "UAN must be exactly 12 digits")
    .regex(/^\d+$/, "UAN must contain only numbers").optional(),
  
  currentAddress: z.string().optional(),
  permanentAddress: z.string().optional(),
  
  bankAccountNumber: z.string().optional(),
  bankIfscCode: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC format").optional(),
  bankName: z.string().optional(),
  
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  specializations: z.array(z.string()).optional(),
  roleIds: z.array(z.string().uuid())
    .min(1, 'At least one role is required'),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const acceptInvitationSchema = z.object({
  token: z.string().length(64, "Invalid invitation token"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

export type RegisterEmployeeInput = z.infer<typeof registerEmployeeSchema>;