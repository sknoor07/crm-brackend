import { Router } from 'express';
import { getPendingPickups, assignTransportPerson, receiveAtLab, getPendingDeliveries, getRepairManagers, assignRepairManager, getPickUpPersonList, getJobsWaitingLabReceipt, getJobsreceivedAtLab, } from './transport.controller.js';
import { assignTransportPersonSchema, receiveLabSchema, assignRepairManagerSchema, } from './transport.validation.js';
import { requireAuth, requireRole, } from '../../shared/middleware/auth.js';
import { validateRequest } from '../../shared/middleware/validateRequest.js';
const router = Router();
router.use(requireAuth, requireRole([
    'transport_manager',
]));
/**
 * Jobs waiting for Transport Manager.
 */
router.get('/pending', getPendingPickups);
router.get('/pickup-persons', getPickUpPersonList);
/**
 * Transport Manager assigns the whole job
 * to a Transport/Repair Person.
 */
router.patch('/assign', validateRequest(assignTransportPersonSchema), assignTransportPerson);
router.get('/get-jobs-with-pending-lab-receipts', getJobsWaitingLabReceipt);
/**
 * Transport Manager receives an individual
 * item at the lab.
 */
router.patch('/receive-lab', validateRequest(receiveLabSchema), receiveAtLab);
router.get('/get-receive-At-lab', getJobsreceivedAtLab);
///////////////////////done/////////////////////////////////////
///////////////////////inspeacton needed///////////////////////////
/**
 * Jobs where every item is ready for delivery.
 */
router.get('/pending-deliveries', getPendingDeliveries);
/**
 * Transport Manager assigns the whole job
 * to a delivery person.
 */
// router.patch(
//   '/assign-delivery',
//   validateRequest(
//     assignDeliverySchema,
//   ),
//   assignDelivery,
// );
router.get('/repair-managers', getRepairManagers);
router.patch('/assign-repair-manager', validateRequest(assignRepairManagerSchema), assignRepairManager);
export default router;
