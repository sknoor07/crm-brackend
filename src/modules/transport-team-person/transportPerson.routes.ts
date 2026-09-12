import { Router } from 'express';

import {
  getAssignedJobs,
  getAssignedDeliveryJobs,
  startDelivery,
  deliverItem,
  getjobdetailswithestimatedquote,
  completeTransportInspection,
  finishOnsiteRepair,
} from './transportPerson.controller.js';

import {
  jobIdParamsSchema,
  startTransportJobSchema,
  requestFinalQuoteSchema,
  rejectJobItemSchema,
  completeOnsiteRepairSchema,
  startDeliverySchema,
  deliverItemSchema,
  finishOnsiteRepairInput,
  completeTransportInspectionSchema,
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


router.get(
  '/getjobdetailswithestimated-quote/:id',
  requireRole(transportRoles,),
  validateRequest(jobIdParamsSchema, "params"),
  getjobdetailswithestimatedquote,
)


// router.patch(
//   '/start',
//   requireRole(transportRoles),
//   validateRequest(startTransportJobSchema),
//   startTransportJobVisit,
// );


router.post('/complete-inspection',requireRole(transportRoles), validateRequest(completeTransportInspectionSchema), completeTransportInspection ,);



////////////////////////////done////////////////////////








// router.patch(
//   '/:jobId/send-job-to-lab',
//   requireRole(transportRoles),
//   validateRequest(jobIdParamsSchema, 'params'),
//   sendJobforInspectionAtLab
// );

// // router.patch(
// //   '/inspect-item',
// //   requireRole(transportRoles),
// //   validateRequest(inspectJobItemSchema),
// //   inspectJobItem,
// // );

// // router.patch(
// //   '/send-item-to-lab',
// //   requireRole(transportRoles),
// //   validateRequest(sendItemToLabSchema),
// //   sendItemToLab,
// // );


// /*
// |--------------------------------------------------------------------------
// | Onsite Repair
// |--------------------------------------------------------------------------
// */

// router.patch(
//   '/request-final-quote',
//   requireRole(transportRoles),
//   validateRequest(requestFinalQuoteSchema),
//   requestFinalQuote,
// );

// router.patch(
//   '/reject-item',
//   requireRole(transportRoles),
//   validateRequest(rejectJobItemSchema),
//   rejectJobItem,
// );

// router.patch(
//   '/start-repair',
//   requireRole(transportRoles),
//   validateRequest(startAndFinishOnsiteRepairSchema),
//   startOnsiteRepair,
// );
router.patch(
  '/finish-repair',
  requireRole(transportRoles),
  validateRequest(finishOnsiteRepairInput),
  finishOnsiteRepair,
);

// router.patch(
//   '/complete-repair',
//   requireRole(transportRoles),
//   validateRequest(completeOnsiteRepairSchema),
//   completeOnsiteRepair,
// );


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