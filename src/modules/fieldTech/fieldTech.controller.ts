import { Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { jobs } from '../../db/schema/index.js';
import { updateJobWithStatusTransition } from '../jobs/status-history.js';

// Helper to check authorization
const isAuthorized = (job: any, userId: string, roles: string[] = []) => {
  return job.assignedPickupTechId === userId || job.assignedDeliveryTechId === userId || roles.includes('admin');
};

// Path B: Mark device as in transit to the lab
export const markInTransit = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.body;
    const techId = req.user?.userId!;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!isAuthorized(job, techId, req.user?.roles)) {
      return res.status(403).json({ error: 'Not authorized to update this job.' });
    }
    if (job.currentStatus !== 'pending_pickup') {
      return res.status(400).json({ error: `Cannot move to transit from '${job.currentStatus}'` });
    }

    const updatedJob = await updateJobWithStatusTransition(
      job.id, job.currentStatus, 'in_transit_to_lab',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ currentStatus: 'in_transit_to_lab', repairLocation: 'lab', updatedAt: new Date() })
          .where(eq(jobs.id, jobId)).returning();
        return result;
      },
      techId,
    );

    return res.status(200).json({ message: 'Job is now in transit to the lab.', job: updatedJob });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
};


// Path A: Request Final Quote for On-Site Repair
export const requestFinalQuote = async (req: Request, res: Response) => {
  try {
    const { jobId, requestedComponents, additionalNotes } = req.body;
    const techId = req.user?.userId!;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!isAuthorized(job, techId, req.user?.roles)) {
      return res.status(403).json({ error: 'Not authorized to update this job.' });
    }
    if (job.currentStatus !== 'pending_pickup') {
      return res.status(400).json({ error: `Cannot request quote from '${job.currentStatus}'` });
    }

    // Save directly to their dedicated columns
    const updatedJob = await updateJobWithStatusTransition(
      job.id, job.currentStatus, 'pending_final_quote',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({
            currentStatus: 'pending_final_quote',
            repairLocation: 'customer_site',
            requestedComponents,
            technicianNotes: additionalNotes || null,
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, jobId)).returning();
        return result;
      },
      techId,
    );

    return res.status(200).json({ 
      message: 'Final quote requested successfully. CS team has been notified.', 
      job: updatedJob 
    });
  } catch (error) {
    console.error('Request quote error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

import { jobComments } from '../../db/schema/index.js'; // Ensure this is imported

// Path B: Technician confirms final drop-off to the customer
export const confirmDelivery = async (req: Request, res: Response) => {
  try {
    const { jobId, deliveryNotes } = req.body;
    const techId = req.user?.userId!;

    // 1. Find the job
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!isAuthorized(job, techId, req.user?.roles)) {
      return res.status(403).json({ error: 'Not authorized to deliver this job.' });
    }
    if (job.currentStatus !== 'out_for_delivery') {
      return res.status(400).json({ error: `Cannot confirm delivery. Job is currently in '${job.currentStatus}' state.` });
    }

    // 2. Update the status
    const updatedJob = await updateJobWithStatusTransition(
      job.id, job.currentStatus, 'delivered',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ currentStatus: 'delivered', updatedAt: new Date() })
          .where(eq(jobs.id, jobId)).returning();
        return result;
      },
      techId,
    );

    // 3. Log delivery notes if provided
    if (deliveryNotes) {
      await db.insert(jobComments).values({
        jobId: job.id,
        userId: techId,
        comment: `[Delivery Confirmed]: ${deliveryNotes}`
      });
    }

    return res.status(200).json({
      message: 'Device successfully delivered to the customer.',
      job: updatedJob,
    });
  } catch (error) {
    console.error('Confirm delivery error:', error);
    return res.status(500).json({ error: 'Internal server error while confirming delivery' });
  }
};


export const getPendingJobsForPickupByPickupPerson = async (req: Request, res: Response) => {
  try{
    const techId = req.user?.userId!;
    const pendingJobs = await db.select().from(jobs)
      .where(and(eq(jobs.currentStatus, 'pending_pickup'),eq(jobs.assignedPickupTechId, techId)))
      .orderBy(desc(jobs.createdAt));
    return res.status(200).json({ jobs: pendingJobs });
  }catch (error) {
    console.error('Error fetching pending jobs for pickup:', error);
    return res.status(500).json({ error: 'Internal server error while fetching pending jobs for pickup' });
  }
}

// Lab technicians handle lab jobs; field technicians handle on-site jobs.
const isRepairCompletionAuthorized = (job: any, userId: string, roles: string[] = []) => {
  if (roles.includes('admin')) {
    return true;
  }

  if (job.assignedPickupTechId === userId) {
    return true;
  }

  return job.assignedPickupTechId === userId && !job.assignedRepairTechId;
};


export const completeRepair = async (req: Request, res: Response) => {
  try {
    const { jobId, repairNotes } = req.body;
    const techId = req.user?.userId!;

    // 1. Find the job
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!isRepairCompletionAuthorized(job, techId, req.user?.roles)) {
      return res.status(403).json({ error: 'Not authorized to complete this job.' });
    }
    
    // Check if the job is actually approved and in progress
    if (job.currentStatus !== 'repair_in_progress') {
      return res.status(400).json({ error: `Cannot complete repair from status '${job.currentStatus}'` });
    }

    // 2. Update the status
    const updatedJob = await updateJobWithStatusTransition(
      job.id, job.currentStatus, 'repair_completed',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ currentStatus: 'repair_completed', updatedAt: new Date() })
          .where(eq(jobs.id, jobId)).returning();
        return result;
      },
      techId,
    );

    // 3. Log the completion notes if provided
    if (repairNotes) {
      await db.insert(jobComments).values({
        jobId: job.id,
        userId: techId,
        comment: `[Repair Completed]: ${repairNotes}`
      });
    }

    return res.status(200).json({
      message: 'Repair marked as completed successfully.',
      job: updatedJob,
    });
  } catch (error) {
    console.error('Complete repair error:', error);
    return res.status(500).json({ error: 'Internal server error while completing repair' });
  }
};

export const getAllRepairInProgress = async(req:Request,res:Response)=>{
  try{
  const techId= req.user?.userId!;
  const data= await db.select().from(jobs).where(eq(jobs.currentStatus,"repair_in_progress"));
  return res.status(200).json({
      message: 'All jobs with final quotes waiting for repairs.',
      job: data,
    });
}catch(error){
  console.error("Fetchind Repair in Progress Failed",error);
  return res.status(500).json({error:'Fetch Failed'});
}
};