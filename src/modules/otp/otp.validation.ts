import z from "zod";

export const forgotPasswordSchema = z.object({
  email: z.email('Invalid email address'),
});

export const verifyPasswordResetOtpSchema = z.object({
  email: z.email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d+$/, 'OTP must contain only numbers'),
});

export const resetPasswordSchema = z.object({
  resetToken: z.string().min(1, 'Reset token is required'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});
export const requestOtpLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const verifyOtpLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z
    .string()
    .length(6, 'OTP must be 6 digits')
    .regex(/^\d+$/, 'OTP must contain only numbers'),
});

export type RequestOtpLoginInput = z.infer<
  typeof requestOtpLoginSchema
>;

export type VerifyOtpLoginInput = z.infer<
  typeof verifyOtpLoginSchema
>;


export type ForgotPasswordInput = z.infer<
  typeof forgotPasswordSchema
>;

export type VerifyPasswordResetOtpInput = z.infer<
  typeof verifyPasswordResetOtpSchema
>;

export type ResetPasswordInput = z.infer<
  typeof resetPasswordSchema
>;