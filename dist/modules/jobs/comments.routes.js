import { Router } from 'express';
import { addJobComment, } from './comments.controller.js';
import { addCommentSchema, } from './comments.validation.js';
import { validateRequest, } from '../../shared/middleware/validateRequest.js';
import { requireAuth, requireRole, } from '../../shared/middleware/auth.js';
const router = Router();
router.post('/', requireAuth, requireRole([
    'admin',
    'customer_service',
    'transport_manager',
    'transport_team_person',
    'repair_manager',
    'repair_person',
]), validateRequest(addCommentSchema), addJobComment);
export default router;
