import { Router } from 'express';
import { acceptInvitation, refreshAccessToken, registerEmployee, loginUser } from './auth.controller.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { acceptInvitationSchema, registerEmployeeSchema, loginSchema } from './auth.validation.js';

const router = Router();

router.post('/register', validateRequest(registerEmployeeSchema), registerEmployee);
router.post('/login', validateRequest(loginSchema), loginUser); 
router.post('/refresh', refreshAccessToken);
router.post('/invitation/accept', validateRequest(acceptInvitationSchema), acceptInvitation);

export default router;