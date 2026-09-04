import { Request, Response } from 'express';
import { and, eq, desc } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { jobs, roles, userRoles, users } from '../../db/schema/index.js';
import { AssignLabTechInput } from './repair.validation.js';
import { updateJobWithStatusTransition } from '../jobs/status-history.js';

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
      eq(roles.name, 'repair_person'),
    ))
    .limit(1);

  return Boolean(technician);
};
import { jobComments } from '../../db/schema/index.js'; // Ensure this is imported

// 1. Get all jobs sitting in the lab waiting for assignment
export const getPendingLabJobs = async (req: Request, res: Response) => {
  try {
    const pendingJobs = await db.select()
      .from(jobs)
      .where(eq(jobs.currentStatus, 'arrived_at_lab'))
      .orderBy(desc(jobs.updatedAt));

    return res.status(200).json({ count: pendingJobs.length, jobs: pendingJobs });
  } catch (error) {
    console.error('Fetch lab jobs error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// 2. Assign the Lab Technician
export const assignLabTech = async (req: Request<{}, {}, AssignLabTechInput>, res: Response) => {
  try {
    const { jobId, labTechId } = req.body;
    const repairManagerId = req.user?.userId; 

    // Find job and verify current status
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.currentStatus !== 'arrived_at_lab') {
      return res.status(400).json({ error: `Job must be 'arrived_at_lab' to assign a technician.` });
    }
    if (!(await isActiveRepairPerson(labTechId))) {
      return res.status(400).json({ error: 'Assigned lab technician must be an active employee with the repair_person role.' });
    }

    // Update job assignment and transition status
    const updatedJob = await updateJobWithStatusTransition(
      job.id, job.currentStatus, 'in_lab_diagnosis',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ assignedRepairTechId: labTechId, repairManagerId, repairLocation: 'lab', currentStatus: 'in_lab_diagnosis', updatedAt: new Date() })
          .where(eq(jobs.id, jobId)).returning();
        return result;
      },
      repairManagerId,
    );

    return res.status(200).json({
      message: 'Lab Technician assigned. Job is now in lab diagnosis.',
      job: updatedJob,
    });
  } catch (error) {
    console.error('Assign lab tech error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

import { requestLabQuoteSchema } from './repair.validation.js';

// Helper to check lab technician authorization.
const isLabTechAuthorized = (job: any, userId: string, roles: string[] = []) => {
  return job.assignedRepairTechId === userId || roles.includes('admin');
};

// Lab technicians handle lab jobs; field technicians handle on-site jobs.
const isRepairCompletionAuthorized = (job: any, userId: string, roles: string[] = []) => {
  if (roles.includes('admin')) {
    return true;
  }

  if (job.assignedRepairTechId === userId) {
    return true;
  }

  return job.assignedPickupTechId === userId && !job.assignedRepairTechId;
};

// 3. Lab Technician requests final quote after diagnosis
export const requestLabQuote = async (req: Request, res: Response) => {
  try {
    const { jobId, requestedComponents, technicianNotes } = req.body;
    const techId = req.user?.userId!;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!isLabTechAuthorized(job, techId, req.user?.roles)) {
      return res.status(403).json({ error: 'Not authorized to diagnose this job.' });
    }
    if (job.currentStatus !== 'in_lab_diagnosis') {
      return res.status(400).json({ error: `Cannot request quote from '${job.currentStatus}'` });
    }

    const updatedJob = await updateJobWithStatusTransition(
      job.id, job.currentStatus, 'pending_final_quote',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ currentStatus: 'pending_final_quote', requestedComponents, technicianNotes: technicianNotes || null, updatedAt: new Date() })
          .where(eq(jobs.id, jobId)).returning();
        return result;
      },
      techId,
    );

    return res.status(200).json({ 
      message: 'Lab diagnosis complete. CS team notified for final quoting.', 
      job: updatedJob 
    });
  } catch (error) {
    console.error('Lab diagnosis error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};




// 4. Lab Technician completes the repair
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