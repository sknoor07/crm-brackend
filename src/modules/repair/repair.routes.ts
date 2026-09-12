import { Router } from 'express';

import {
  getPendingRepairAssignments,
  assignRepairPerson,

  getAssignedRepairItems,
  startDiagnosis,
  requestFinalQuote,
  startRepair,
  completeRepair,

  getPendingRepairInspections,
  approveRepair,
  rejectRepairInspection,
} from './repair.controller.js';

import {
  assignRepairPersonSchema,

  startDiagnosisSchema,
  requestFinalQuoteSchema,
  startRepairSchema,
  completeRepairSchema,

  approveRepairSchema,
  rejectRepairInspectionSchema,
} from './repair.validation.js';

import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';

import {
  validateRequest,
} from '../../shared/middleware/validateRequest.js';


const router = Router();

router.use(requireAuth);


/*
 * ============================================================
 * REPAIR TEAM MANAGER
 * ============================================================
 */

const repairManagerRoles = [
  'admin',
  'repair_manager',
];


/**
 * Get items waiting for Repair Person assignment.
 *
 * GET /repair/pending-assignment
 */
router.get(
  '/pending-assignment',
  requireRole(repairManagerRoles),
  getPendingRepairAssignments,
);


/**
 * Assign an individual item to a Repair Person.
 *
 * PATCH /repair/assign
 */
router.patch(
  '/assign',
  requireRole(repairManagerRoles),
  validateRequest(                                //check
    assignRepairPersonSchema,
  ),
  assignRepairPerson,
);


/**
 * Get completed lab repairs waiting
 * for Repair Manager inspection.
 *
 * GET /repair/pending-inspection
 */
router.get(
  '/pending-inspection',
  requireRole(repairManagerRoles),
  getPendingRepairInspections,
);


/**
 * Approve a completed repair.
 *
 * PATCH /repair/approve
 */
router.patch(
  '/approve',
  requireRole(repairManagerRoles),
  validateRequest(
    approveRepairSchema,
  ),
  approveRepair,
);


/**
 * Reject a completed repair during inspection.
 *
 * PATCH /repair/reject-inspection
 */
router.patch(
  '/reject-inspection',
  requireRole(repairManagerRoles),
  validateRequest(
    rejectRepairInspectionSchema,
  ),
  rejectRepairInspection,
);


/*
 * ============================================================
 * REPAIR PERSON
 * ============================================================
 */

const repairPersonRoles = [
  'admin',
  'repair_person',
];


/**
 * Get items currently assigned to
 * the authenticated Repair Person.
 *
 * GET /repair/my-items
 */
router.get(
  '/my-items',
  requireRole(repairPersonRoles),
  getAssignedRepairItems,
);


/**
 * Start diagnosis.
 *
 * PATCH /repair/start-diagnosis
 */
router.patch(
  '/start-diagnosis',
  requireRole(repairPersonRoles),
  validateRequest(
    startDiagnosisSchema,
  ),
  startDiagnosis,
);


/**
 * Finish diagnosis and send item
 * to CS for final quotation.
 *
 * PATCH /repair/request-final-quote
 */
router.patch(
  '/request-final-quote',
  requireRole(repairPersonRoles),
  validateRequest(                              // check
    requestFinalQuoteSchema,
  ),
  requestFinalQuote,
);


/**
 * Start an authorized lab repair.
 *
 * PATCH /repair/start-repair
 */
router.patch(
  '/start-repair',
  requireRole(repairPersonRoles),
  validateRequest(
    startRepairSchema,
  ),
  startRepair,
);


/**
 * Complete a lab repair and send it
 * to Repair Manager inspection.
 *
 * PATCH /repair/complete-repair
 */
router.patch(
  '/complete-repair',
  requireRole(repairPersonRoles),
  validateRequest(
    completeRepairSchema,
  ),
  completeRepair,
);


export default router;