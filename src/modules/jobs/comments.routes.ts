import { Router } from 'express';
import { addJobComment } from './comments.controller.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
import { addCommentSchema } from './comments.validation.js';
import { requireAuth, requireRole } from '../../shared/middleware/auth.js';

const router = Router();

// POST /api/v1/comments
// Allowed by all internal roles
router.post(
  '/',
  requireAuth,
  requireRole(['admin', 'customer_service', 'transport_manager', 'repair_manager', 'repair_person']),
  validateRequest(addCommentSchema),
  addJobComment
);

export default router;