import { Request, Response } from 'express';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { jobs, roles, userRoles, users } from '../../db/schema/index.js';
import { AssignTechnicianInput } from './transport.validation.js';
import { updateJobWithStatusTransition } from '../jobs/status-history.js';

import { ReceiveLabInput } from './transport.validation.js';

const isActiveRepairPerson = async (userId: string) => {
  const [technician] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(and(
      eq(users.id, userId),
      eq(users.userType, 'employee'),
      eq(users.isActive, true),
      inArray(roles.name, ['repair_person', 'pickup_person'])  
    ))
    .limit(1);

  return Boolean(technician);
};

// 1. List all jobs ready for Transport Manager review
export const getPendingPickups = async (req: Request, res: Response) => {
  try {
    const pendingJobs = await db.select()
      .from(jobs)
      .where(eq(jobs.currentStatus, 'ready_for_pickup'))
      .orderBy(desc(jobs.createdAt));

    return res.status(200).json({ jobs: pendingJobs });
  } catch (error) {
    console.error('Fetch pending pickups error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// 2. Assign the Field Technician
export const assignTechnician = async (req: Request<{}, {}, AssignTechnicianInput>, res: Response) => {
  try {
    const { jobId, technicianId } = req.body;
    const transportManagerId = req.user?.userId; 

    // Find job and verify current status
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.currentStatus !== 'ready_for_pickup') {
      return res.status(400).json({ error: `Job is not ready for pickup.` });
    }
    if (!(await isActiveRepairPerson(technicianId))) {
      return res.status(400).json({ error: 'Assigned technician must be an active employee with the repair_person role.' });
    }

    // Update job assignment and transition status
    const updatedJob = await updateJobWithStatusTransition(
      job.id, job.currentStatus, 'pending_pickup',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ assignedPickupTechId: technicianId, transportManagerId, currentStatus: 'pending_pickup', updatedAt: new Date() })
          .where(eq(jobs.id, jobId)).returning();
        return result;
      },
      transportManagerId,
    );

    return res.status(200).json({
      message: 'Technician assigned successfully. Job is pending pickup.',
      job: updatedJob,
    });
  } catch (error) {
    console.error('Assign technician error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


// 3. Receive the device physically at the lab
export const receiveAtLab = async (req: Request<{}, {}, ReceiveLabInput>, res: Response) => {
  try {
    const { jobId } = req.body;

    // 1. Find the job
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    
    if (!job) return res.status(404).json({ error: 'Job not found' });
    
    // 2. Ensure the job was actually in transit
    if (job.currentStatus !== 'in_transit_to_lab') {
      return res.status(400).json({ 
        error: `Cannot receive device at lab. Current status is '${job.currentStatus}', expected 'in_transit_to_lab'.` 
      });
    }

    // 3. Update the job status
    const updatedJob = await updateJobWithStatusTransition(
      job.id, job.currentStatus, 'arrived_at_lab',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ currentStatus: 'arrived_at_lab', updatedAt: new Date() })
          .where(eq(jobs.id, jobId)).returning();
        return result;
      },
      req.user?.userId,
    );

    return res.status(200).json({
      message: 'Device successfully received at the lab. Handover to repair team ready.',
      job: updatedJob,
    });
  } catch (error) {
    console.error('Receive at lab error:', error);
    return res.status(500).json({ error: 'Internal server error while receiving device' });
  }
};
import { assignDeliverySchema } from './transport.validation.js';

// 4. View jobs ready for return delivery
export const getPendingDeliveries = async (req: Request, res: Response) => {
  try {
    const pendingDeliveries = await db.select()
      .from(jobs)
      .where(and(
        eq(jobs.currentStatus, 'repair_completed'),
        eq(jobs.repairLocation, 'lab'),
      ))
      .orderBy(desc(jobs.updatedAt));

    return res.status(200).json({ count: pendingDeliveries.length, jobs: pendingDeliveries });
  } catch (error) {
    console.error('Fetch deliveries error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// 5. Assign technician for return delivery
export const assignDelivery = async (req: Request, res: Response) => {
  try {
    const { jobId, technicianId } = req.body;
    const transportManagerId = req.user?.userId;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.currentStatus !== 'repair_completed') {
      return res.status(400).json({ error: `Cannot assign delivery. Job is in '${job.currentStatus}' state.` });
    }
    if (!(await isActiveRepairPerson(technicianId))) {
      return res.status(400).json({ error: 'Assigned technician must be an active employee with the repair_person role.' });
    }

    const updatedJob = await updateJobWithStatusTransition(
      job.id, job.currentStatus, 'out_for_delivery',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ assignedDeliveryTechId: technicianId, transportManagerId, currentStatus: 'out_for_delivery', updatedAt: new Date() })
          .where(eq(jobs.id, jobId)).returning();
        return result;
      },
      transportManagerId,
    );

    return res.status(200).json({
      message: 'Technician assigned for return delivery.',
      job: updatedJob,
    });
  } catch (error) {
    console.error('Assign delivery error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
