import { Router } from 'express';
import { getPendingLabJobs, assignLabTech, requestLabQuote, completeRepair } from './repair.controller.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { assignLabTechSchema, completeRepairSchema, requestLabQuoteSchema } from './repair.validation.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';

const router = Router();

// 1. Require authentication globally for all repair routes
router.use(requireAuth);

// 2. Manager Routes: Only Admin and Repair Manager can view the pending queue and assign tasks
router.get(
  '/pending', 
  requireRole(['admin', 'repair_manager']), 
  getPendingLabJobs
);

router.patch(
  '/assign', 
  requireRole(['admin', 'repair_manager']), 
  validateRequest(assignLabTechSchema), 
  assignLabTech
);

// 3. Technician Routes: Only Admin and Repair Person can diagnose and complete repairs
router.patch(
  '/request-quote', 
  requireRole(['admin', 'repair_person']), 
  validateRequest(requestLabQuoteSchema), 
  requestLabQuote
);

router.patch(
  '/complete', 
  requireRole(['admin', 'repair_person']), 
  validateRequest(completeRepairSchema), 
  completeRepair
);

export default router;