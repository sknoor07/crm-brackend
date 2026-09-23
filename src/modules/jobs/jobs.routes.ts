import { Router } from 'express';

import {
  // createJobByCS,
   getDeviceCategories,
  getJobWithItems,
} from './jobs.controller.js';


import {
  createJobSchema,
} from './jobs.validation.js';

import {
  validateRequest,
} from '../../shared/middleware/validateRequest.js';

import {
  requireAuth,
  requireRole,
} from '../../shared/middleware/auth.js';
import { getJobDetailedStatusHistory, getJobItemDetailedStatusHistory, listJobs } from './read.controller.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/recent',
  requireRole([
    'admin',
    'customer_service',
    'transport_manager',
    'transport_team_person',
    'repair_manager',
    'repair_person',
    'customer',
  ]),
  listJobs,
);

router.get(
  '/device-categories',
  requireRole([
    'admin',
    'customer_service',
    'customer',
  ]),
  getDeviceCategories,
);

router.get(
  '/jobs-with-items',
  requireRole([
    'admin','customer_service',
  ]),
  getJobWithItems,
)

router.get(
  '/:jobId/detailed-job-status-history',
  requireRole([
    'admin',
    'customer_service',
  ]),
  getJobDetailedStatusHistory,
);
router.get(
  '/:jobItemId/detailed-item-status-history',
  requireRole([
    'admin',
    'customer_service',
  ]),
  getJobItemDetailedStatusHistory,
);
// router.get(
//   '/:jobId',
//   requireRole([
//     'admin',
//     'customer_service',
//     'transport_manager',
//     'transport_team_person',
//     'repair_manager',
//     'repair_person',
//     'customer',
//   ]),
//   getJobById,
// );

router.get(
  '/',
  requireRole([
    'admin',
    'customer_service',
    'transport_manager',
    'transport_team_person',
    'repair_manager',
    'repair_person',
    'customer',
  ]),
  listJobs,
);

// router.post(
//   '/',
//   requireRole([
//     'admin',
//     'customer_service',
//   ]),
//   validateRequest(createJobSchema),
//   createJobByCS,
// );

export default router;