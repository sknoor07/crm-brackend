import { Router } from 'express';
import { createCustomerJob, customerLogin, getAllOrders, getCustomerPendingQuotes, getCustomerProfile, getOrderHistory, registerCustomer, respondToQuote, updateCustomerProfile, updatePassword,
// respondToQuote,
 } from './customer.controller.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { createCustomerJobSchema, quoteResponseSchema, } from './customer.validation.js';
import { requireAuth, requireRole, } from '../../shared/middleware/auth.js';
const router = Router();
router.post("/register", registerCustomer);
router.post("/login", customerLogin);
router.get('/orders', requireAuth, requireRole(['customer']), getAllOrders);
router.get('/history', requireAuth, requireRole(['customer']), getOrderHistory);
router.post('/jobs', requireAuth, requireRole(['customer']), validateRequest(createCustomerJobSchema), createCustomerJob);
router.patch('/quote-response', requireAuth, requireRole([
    'admin',
    'customer_service',
    'customer',
]), validateRequest(quoteResponseSchema), respondToQuote);
router.get('/quotes/pending', requireAuth, requireRole(['customer']), getCustomerPendingQuotes);
router.get('/profile', requireAuth, requireRole(['customer']), getCustomerProfile);
router.patch("/update-profile", requireAuth, requireRole(['customer']), updateCustomerProfile);
router.patch('/update-password', requireAuth, requireRole(['customer']), updatePassword);
export default router;
