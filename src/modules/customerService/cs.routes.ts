import { Router } from 'express';

import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { csApproveJobSchema, generateFinalQuoteSchema } from './cs.validation.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';
import { approveJobByCS, generateFinalQuote, getallJobsWaitingForCSApproval, getAllJobsWaitingToBeClosed, getPendingFinalQuotes } from './cs.controller.js';
import { closeJobRequest } from './cs.controller.js';
import { closeJobSchema } from './cs.validation.js';

const router = Router();
router.use(requireAuth);
// PATCH /api/v1/cs/approve-job
// Restricted: Only Admin and Customer Service personnel can approve/update customer jobs.
router.patch('/approve-job', requireRole(['admin', 'customer_service']),validateRequest(csApproveJobSchema),approveJobByCS);

// PATCH /api/v1/cs/final-quote
router.patch(
  '/final-quote',
  requireRole(['admin', 'customer_service']),
  validateRequest(generateFinalQuoteSchema),
  generateFinalQuote
);

router.get(
  '/pending-quotes',
  requireRole(['admin', 'customer_service']),
  getPendingFinalQuotes
);



// PATCH /api/v1/cs/close
router.patch(
  '/close',
  requireRole(['admin', 'customer_service']),
  validateRequest(closeJobSchema),
  closeJobRequest
);
export default router;

router.get(
  '/getJobsWaitingForCSApproval',
  requireRole(['admin', 'customer_service']),
  getallJobsWaitingForCSApproval
);

router.get(
  '/getAllJobsWaitingToBeClosed',
  requireRole(['admin', 'customer_service']),
  getAllJobsWaitingToBeClosed
);