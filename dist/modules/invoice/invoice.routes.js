// src/modules/invoice/invoice.routes.ts
import { Router } from 'express';
import { downloadInvoice, } from './invoice.controller.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';
const router = Router();
router.use(requireAuth);
router.get('/:invoiceId/download', requireRole(['customer']), downloadInvoice);
export default router;
