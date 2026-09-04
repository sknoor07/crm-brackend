import { Router } from 'express';
import { getRoles } from './roles.controller.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';


const router = Router();

router.get(
  '/',
  requireAuth,
  requireRole(['admin']),
  getRoles
);

export default router;