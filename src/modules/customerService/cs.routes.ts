import { Router } from 'express';

import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';

import {
  validateRequest,
} from '../../shared/middleware/validateRequest.js';

import {
  approveJobItemByCS,
  rejectJobItemByCS,
  generateFinalQuote,
  getPendingFinalQuotes,
  getJobsWaitingForCSApproval,
  getJobsWaitingToBeClosed,
  closeJobRequest,
  getPendingOnsiteConfirmations,
  confirmOnsiteRepair,
} from './cs.controller.js';

import {
  csApproveJobItemSchema,
  csRejectJobItemSchema,
  generateFinalQuoteSchema,
  closeJobSchema,
  confirmOnsiteRepairSchema,
} from './cs.validation.js';

const router = Router();

router.use(requireAuth);

const csRoles = [
  'admin',
  'customer_service',
];

router.patch(
  '/approve-item',
  requireRole(csRoles),
  validateRequest(
    csApproveJobItemSchema,
  ),
  approveJobItemByCS,
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
  '/pending-quotes',
  requireRole(csRoles),
  getPendingFinalQuotes,
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