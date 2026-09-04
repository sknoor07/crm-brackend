import { Router } from 'express';
import { createCustomerJob, respondToQuote } from './customer.controller.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { createCustomerJobSchema, quoteResponseSchema } from './customer.validation.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';

const router = Router();

router.post(
  '/jobs',
  requireAuth,
  requireRole(['customer']),
  validateRequest(createCustomerJobSchema),
  createCustomerJob
);

// PATCH /api/v1/customer/quote-response
router.patch(
  '/quote-response',
  requireAuth,
  requireRole(['admin', 'customer_service', 'customer']),
  validateRequest(quoteResponseSchema),
  respondToQuote
);

export default router;