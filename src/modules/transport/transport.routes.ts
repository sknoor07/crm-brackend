import { Router } from 'express';
import { getPendingPickups, assignTechnician, receiveAtLab, assignDelivery, getPendingDeliveries } from './transport.controller.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { assignDeliverySchema, assignTechnicianSchema, receiveLabSchema } from './transport.validation.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';

const router = Router();

// Apply auth and role checks to all transport routes
router.use(requireAuth, requireRole(['admin', 'transport_manager']));

router.get('/pending', getPendingPickups);
router.patch('/assign', validateRequest(assignTechnicianSchema), assignTechnician);
// PATCH /api/v1/transport/receive-lab
router.patch(
  '/receive-lab',
  validateRequest(receiveLabSchema),
  receiveAtLab
);

// GET /api/v1/transport/pending-deliveries
router.get('/pending-deliveries', getPendingDeliveries);

// PATCH /api/v1/transport/assign-delivery
router.patch('/assign-delivery', validateRequest(assignDeliverySchema), assignDelivery);
export default router;