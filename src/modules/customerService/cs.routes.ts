import { Router } from 'express';

import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';

import {
  validateRequest,
} from '../../shared/middleware/validateRequest.js';

import {

  generateFinalQuote,
  getJobsWaitingForCSApproval,
  getJobsWaitingToBeClosed,
  closeJobRequest,

  approveJobByCS,
  searchCustomers,
  seacrhCustomerDetailswithJob,
  getjobDetails,
  getPendingFinalQuotes,
} from './cs.controller.js';

import {
  csApproveJobItemSchema,

  generateFinalQuoteSchema,

  csApproveJobAndJobItemSchema,
  csGetCustomerDetail,
  searchCustomerSchema,
  closeJobSchema,

} from './cs.validation.js';


const router = Router();

router.use(requireAuth);

const csRoles = [
  'customer_service',
];


router.get(
  '/pending-approval',
  requireRole(csRoles),
  getJobsWaitingForCSApproval,
);

router.get(
  "/getCustomerDetails/:id",
  requireRole(csRoles),
  validateRequest(csGetCustomerDetail, "params"),
  seacrhCustomerDetailswithJob,
);

router.get(
  '/search',
  requireRole(csRoles),
  validateRequest(searchCustomerSchema, 'query'),
  searchCustomers,
);

// final close after talking with customer
router.get(
  '/ready-for-closure',
  requireRole(csRoles),
  getJobsWaitingToBeClosed,
);

router.patch(
  '/close',
  requireRole(csRoles),
  validateRequest(closeJobSchema),
  closeJobRequest,
);


router.patch(
  '/submit-job',
  requireRole(csRoles),
  validateRequest(
    csApproveJobAndJobItemSchema,
  ),
  approveJobByCS,
);

router.get(
  '/getjobdetails/:id',
  requireRole(csRoles),
  getjobDetails,
)


router.get(
  '/pending-final-quotes',
  requireRole(csRoles),
  getPendingFinalQuotes,
);







///done till here








router.patch(
  '/final-quote',
  requireRole(csRoles),
  validateRequest(
    generateFinalQuoteSchema,
  ),
  generateFinalQuote,
);




// router.get(
//   '/pending-onsite-confirmation',
//   requireRole(csRoles),
//   getPendingOnsiteConfirmations,
// );

// router.patch(
//   '/confirm-onsite-repair',
//   requireRole(csRoles),
//   validateRequest(
//     confirmOnsiteRepairSchema,
//   ),
//   confirmOnsiteRepair,
// );


export default router;