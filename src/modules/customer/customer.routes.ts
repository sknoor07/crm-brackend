import { Router } from 'express';

import {
  createCustomerJob,
  respondToQuote,
  // respondToQuote,
} from './customer.controller.js';


import { validateRequest } from '../../shared/middleware/validateRequest.js';

import {
  createCustomerJobSchema,
  quoteResponseSchema,
} from './customer.validation.js';

import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';
import { getCustomerOrders } from './orders.controller.js';

const router = Router();

router.get(
  '/orders',
  requireAuth,
  requireRole(['customer']),
  getCustomerOrders,
);

router.post(
  '/jobs',
  requireAuth,
  requireRole(['customer']),
  validateRequest(createCustomerJobSchema),
  createCustomerJob,
);

router.patch(
  '/quote-response',
  requireAuth,
  requireRole([
    'admin',
    'customer_service',
    'customer',
  ]),
  validateRequest(quoteResponseSchema),
  respondToQuote,
);

export default router;