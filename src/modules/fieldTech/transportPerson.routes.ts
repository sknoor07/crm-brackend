import { Router } from 'express';

import {
  getAssignedJobs,
  startTransportJob,
  getItemsForInspection,
  inspectJobItem,
  sendItemToLab,
  requestFinalQuote,
  rejectJobItem,
  startOnsiteRepair,
  completeOnsiteRepair,
  getAssignedDeliveryJobs,
  startDelivery,
  deliverItem,
} from './transportPerson.controller.js';

import {
  jobIdParamsSchema,
  startTransportJobSchema,
  inspectJobItemSchema,
  sendItemToLabSchema,
  requestFinalQuoteSchema,
  rejectJobItemSchema,
  startOnsiteRepairSchema,
  completeOnsiteRepairSchema,
  startDeliverySchema,
  deliverItemSchema,
} from './transportPerson.validation.js';

import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';

import {
  validateRequest,
} from '../../shared/middleware/validateRequest.js';


const router = Router();

router.use(requireAuth);

const transportRoles = [
  'admin',
  'transport_team_person',
];

const deliveryRoles = [
  'admin',
  'transport_team_person',
  'repair_person',
];


/*
|--------------------------------------------------------------------------
| Transport / Customer Visit
|--------------------------------------------------------------------------
*/

router.get(
  '/assigned-jobs',
  requireRole(transportRoles),
  getAssignedJobs,
);

router.patch(
  '/start',
  requireRole(transportRoles),
  validateRequest(startTransportJobSchema),
  startTransportJob,
);

router.get(
  '/:jobId/items',
  requireRole(transportRoles),
  validateRequest(jobIdParamsSchema, 'params'),
  getItemsForInspection,
);

router.patch(
  '/inspect-item',
  requireRole(transportRoles),
  validateRequest(inspectJobItemSchema),
  inspectJobItem,
);

router.patch(
  '/send-item-to-lab',
  requireRole(transportRoles),
  validateRequest(sendItemToLabSchema),
  sendItemToLab,
);


/*
|--------------------------------------------------------------------------
| Onsite Repair
|--------------------------------------------------------------------------
*/

router.patch(
  '/request-final-quote',
  requireRole(transportRoles),
  validateRequest(requestFinalQuoteSchema),
  requestFinalQuote,
);

router.patch(
  '/reject-item',
  requireRole(transportRoles),
  validateRequest(rejectJobItemSchema),
  rejectJobItem,
);

router.patch(
  '/start-repair',
  requireRole(transportRoles),
  validateRequest(startOnsiteRepairSchema),
  startOnsiteRepair,
);

router.patch(
  '/complete-repair',
  requireRole(transportRoles),
  validateRequest(completeOnsiteRepairSchema),
  completeOnsiteRepair,
);


/*
|--------------------------------------------------------------------------
| Delivery
|--------------------------------------------------------------------------
*/

router.get(
  '/delivery-jobs',
  requireRole(deliveryRoles),
  getAssignedDeliveryJobs,
);

router.patch(
  '/start-delivery',
  requireRole(deliveryRoles),
  validateRequest(startDeliverySchema),
  startDelivery,
);

router.patch(
  '/deliver-item',
  requireRole(deliveryRoles),
  validateRequest(deliverItemSchema),
  deliverItem,
);


export default router;