import { Router } from 'express';
import { createJobByCS, getDeviceCategories } from './jobs.controller.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { createJobSchema } from './jobs.validation.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';

const router = Router();
router.use(requireAuth);
router.get('/device-categories', requireRole(['admin', 'customer_service', 'customer']), getDeviceCategories);
// POST /api/v1/jobs 
// Restricted: Only authenticated Admin or Customer Service reps can create jobs.
// If a 'repair_person' tries this, they get a 403 Forbidden error.
router.post('/', requireRole(['admin', 'customer_service']), validateRequest(createJobSchema), createJobByCS);

export default router;