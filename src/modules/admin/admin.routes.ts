import { Router } from 'express';

import { getAdminAnalytics } from './admin.controller.js';
import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';

const router = Router();

router.get(
  '/analytics',
  requireAuth,
  requireRole(['admin']),
  getAdminAnalytics,
);

export default router;
