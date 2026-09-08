import { Router } from 'express';

import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';

import {
  validateRequest,
} from '../../shared/middleware/validateRequest.js';

import {
  rejectJobItemByCS,
  generateFinalQuote,
  getJobsWaitingForCSApproval,
  getJobsWaitingToBeClosed,
  closeJobRequest,
  getPendingOnsiteConfirmations,
  confirmOnsiteRepair,
  approveJobByCS,
  getPendingFinalQuotesOnSite,
  getCustomerDetails,
} from './cs.controller.js';

import {
  csApproveJobItemSchema,
  csRejectJobItemSchema,
  generateFinalQuoteSchema,
  closeJobSchema,
  confirmOnsiteRepairSchema,
  csApproveJobAndJobItemSchema,
  csGetCustomerDetail,
} from './cs.validation.js';


const router = Router();

router.use(requireAuth);

const csRoles = [
  'customer_service',
];

router.patch(
  '/approve-item',
  requireRole(csRoles),
  validateRequest(
    csApproveJobAndJobItemSchema,
  ),
  approveJobByCS,
);

router.get(
  "/getCustomerDetails/:id",
  requireRole(csRoles),
  validateRequest(csGetCustomerDetail, "params"),
  getCustomerDetails
);
router.patch(
  '/reject-item',
  requireRole(csRoles),
  validateRequest(
    csRejectJobItemSchema,
  ),
  rejectJobItemByCS,
);

router.patch(
  '/final-quote',
  requireRole(csRoles),
  validateRequest(
    generateFinalQuoteSchema,
  ),
  generateFinalQuote,
);

router.get(
  '/pending-final-quotes-onsite',
  requireRole(csRoles),
  getPendingFinalQuotesOnSite,
);

router.get(
  '/pending-approval',
  requireRole(csRoles),
  getJobsWaitingForCSApproval,
);

router.get(
  '/pending-onsite-confirmation',
  requireRole(csRoles),
  getPendingOnsiteConfirmations,
);

router.patch(
  '/confirm-onsite-repair',
  requireRole(csRoles),
  validateRequest(
    confirmOnsiteRepairSchema,
  ),
  confirmOnsiteRepair,
);

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

export default router;