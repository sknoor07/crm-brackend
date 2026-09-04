import { Router } from 'express';
import { markInTransit, requestFinalQuote, confirmDelivery, getPendingJobsForPickupByPickupPerson, completeRepair, getAllRepairInProgress } from './fieldTech.controller.js';
import { updateTransitSchema, requestQuoteSchema, confirmDeliverySchema, completeRepairSchema } from './fieldTech.validation.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';

const router = Router();

// 1. Require authentication globally for all field tech routes
router.use(requireAuth);

// 2. Logistics Routes: Both 'pickup_person' and 'repair_person' can handle transit and delivery
router.patch(
  '/transit', 
  requireRole(['admin', 'pickup_person', 'repair_person']), 
  validateRequest(updateTransitSchema), 
  markInTransit
);

router.patch(
  '/deliver', 
  requireRole(['admin', 'pickup_person', 'repair_person']), 
  validateRequest(confirmDeliverySchema), 
  confirmDelivery
);

// 3. Repair Route: Only a trained 'repair_person' can diagnose and request a quote on-site
router.patch(
  '/request-quote', 
  requireRole(['admin', 'repair_person','pickup_person']), 
  validateRequest(requestQuoteSchema), 
  requestFinalQuote
);

router.get(
  '/pending-pickups', 
  requireRole(['admin', 'pickup_person']),
  getPendingJobsForPickupByPickupPerson
);
router.patch(
  '/complete', 
  requireRole(['admin', 'pickup_person']), 
  validateRequest(completeRepairSchema), 
  completeRepair
);


router.get(
  '/getAllRepairInProgress',
  requireRole(['admin', 'pickup_person']),
  getAllRepairInProgress
)

export default router;