import { Router } from 'express';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { forgotPassword, requestOtpLogin, resetPassword, verifyOtpLogin, verifyPasswordResetOtp } from './otp.controller.js';
import { forgotPasswordSchema, requestOtpLoginSchema, resetPasswordSchema, verifyOtpLoginSchema, verifyPasswordResetOtpSchema, } from './otp.validation.js';
const router = Router();
router.post(
  '/password/forgot',
  validateRequest(forgotPasswordSchema),
  forgotPassword,
);
router.post(
  '/password/verify-otp',
  validateRequest(verifyPasswordResetOtpSchema),
  verifyPasswordResetOtp,
);
router.post(
  '/password/reset',
  validateRequest(resetPasswordSchema),
  resetPassword,
);

router.post(
  '/login/request',
  validateRequest(requestOtpLoginSchema),
  requestOtpLogin,
);

router.post(
  '/login/verify',
  validateRequest(verifyOtpLoginSchema),
  verifyOtpLogin,
);
export default router;