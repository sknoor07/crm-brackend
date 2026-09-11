import { Router } from 'express';

import {
  getPendingPickups,
  assignTransportPerson,
  receiveAtLab,
  getPendingDeliveries,
  assignDelivery,
  getRepairManagers,
  assignRepairManager,
  getPickUpPersonList,
} from './transport.controller.js';

import {
  assignTransportPersonSchema,
  receiveLabSchema,
  assignDeliverySchema,
  assignRepairManagerSchema,
} from './transport.validation.js';

import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';

const router = Router();

router.use(
  requireAuth,
  requireRole([
    'transport_manager',
  ]),
);


/**
 * Jobs waiting for Transport Manager.
 */
router.get(
  '/pending',
  getPendingPickups,
);

router.get(
  '/pickup-persons',
  getPickUpPersonList,
);











///////////////////////done/////////////////////////////////////







/**
 * Transport Manager assigns the whole job
 * to a Transport/Repair Person.
 */
router.patch(
  '/assign',
  validateRequest(
    assignTransportPersonSchema,
  ),
  assignTransportPerson,
);


/**
 * Transport Manager receives an individual
 * item at the lab.
 */
router.patch(
  '/receive-lab',
  validateRequest(receiveLabSchema),
  receiveAtLab,
);


/**
 * Jobs where every item is ready for delivery.
 */
router.get(
  '/pending-deliveries',
  getPendingDeliveries,
);


/**
 * Transport Manager assigns the whole job
 * to a delivery person.
 */
router.patch(
  '/assign-delivery',
  validateRequest(
    assignDeliverySchema,
  ),
  assignDelivery,
);


router.get(
  '/repair-managers',
  getRepairManagers,
);

router.patch(
  '/assign-repair-manager',
  validateRequest(assignRepairManagerSchema),
  assignRepairManager,
);
export default router;

