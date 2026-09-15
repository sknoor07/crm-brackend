import { Router } from 'express';

import {
  createCustomerJob,
  getAllOrders,
  getCustomerPendingQuotes,
  registerCustomer,
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

router.post("/register",registerCustomer);

router.get(
  '/orders',
  requireAuth,
  requireRole(['customer']),
  getAllOrders,
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


router.get(
  '/quotes/pending',
  requireAuth,
  requireRole(['customer']),
  getCustomerPendingQuotes,
);
export default router;