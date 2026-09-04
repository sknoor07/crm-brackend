import { Router } from 'express';
import { acceptInvitation, refreshAccessToken, registerEmployee, loginUser, getCurrentUser } from './auth.controller.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { acceptInvitationSchema, registerEmployeeSchema, loginSchema } from './auth.validation.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';

const router = Router();

// Employee accounts may only be created by an authenticated administrator.
router.post(
  '/register',
  requireAuth,
  requireRole(['admin']),
  validateRequest(registerEmployeeSchema),
  registerEmployee,
);
router.post('/login', validateRequest(loginSchema), loginUser); 
router.post('/refresh', refreshAccessToken);
router.post('/invitation/accept', validateRequest(acceptInvitationSchema), acceptInvitation);
router.get("/me", requireAuth, getCurrentUser);
export default router;