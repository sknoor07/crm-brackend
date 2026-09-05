import { Router } from 'express';

import {
  getDashboardSummary,
  getRecentJobs,
} from './dashboard.controller.js';
import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.use(
  requireRole([
    'admin',
    'customer_service',
    'transport_manager',
    'transport_team_person',
    'repair_manager',
    'repair_person',
    'customer',
  ]),
);

router.get('/summary', getDashboardSummary);
router.get('/recent-jobs', getRecentJobs);

export default router;
