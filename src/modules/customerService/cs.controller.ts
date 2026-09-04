import { Request, Response } from 'express';

import { db } from '../../config/database.js';
import { jobs } from '../../db/schema/index.js';
import { CSApproveJobInput } from './cs.validation.js';
import { deviceServiceCharges } from '../../db/schema/index.js'; // Ensure this import exists
import { GenerateFinalQuoteInput } from './cs.validation.js';
import { desc, eq } from 'drizzle-orm';
import { jobComments } from '../../db/schema/index.js';
import { updateJobWithStatusTransition } from '../jobs/status-history.js';

export const approveJobByCS = async (req: Request<{}, {}, CSApproveJobInput>, res: Response) => {
  try {
    const { jobId, estimatedComponentsCost } = req.body;

    // 1. Find the job
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // 2. Verify it is actually pending CS verification
    if (job.currentStatus !== 'pending_cs_verification') {
      return res.status(400).json({ 
        error: `Job cannot be approved because its current status is '${job.currentStatus}' instead of 'pending_cs_verification'` 
      });
    }

    // 3. Prepare update data
    const updateData: any = {
      currentStatus: 'ready_for_pickup', // Transition to Transport Manager view
      updatedAt: new Date(),
    };

    if (estimatedComponentsCost !== undefined) {
      updateData.estimatedComponentsCost = estimatedComponentsCost.toString();
    }

    // 4. Perform update in database
    const updatedJob = await updateJobWithStatusTransition(
      job.id,
      job.currentStatus,
      'ready_for_pickup',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set(updateData)
          .where(eq(jobs.id, jobId))
          .returning();
        return result;
      },
      req.user?.userId,
    );

    return res.status(200).json({
      message: 'Job successfully verified and approved by CS. Moved to ready for pickup.',
      job: updatedJob,
    });

  } catch (error) {
    console.error('CS Job Approval Error:', error);
    return res.status(500).json({ error: 'Internal server error during job approval' });
  }
};


export const generateFinalQuote = async (req: Request<{}, {}, GenerateFinalQuoteInput>, res: Response) => {
  try {
    const { jobId, finalComponentsCost } = req.body;

    // 1. Find the job
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.currentStatus !== 'pending_final_quote') {
      return res.status(400).json({ error: `Cannot generate final quote from status '${job.currentStatus}'` });
    }

    // 2. Automatically pull the correct hidden service charge for this device category
    if (!job.deviceCategory) {
      return res.status(400).json({ error: 'Device category is required to calculate the service charge' });
    }

    const [serviceCharge] = await db
      .select()
      .from(deviceServiceCharges)
      .where(eq(deviceServiceCharges.deviceCategory, job.deviceCategory))
      .limit(1);

    if (!serviceCharge) {
      return res.status(400).json({ error: `No service charge configured for category: ${job.deviceCategory}` });
    }

    // 3. Update the job with the final costs and change status
    const updatedJob = await updateJobWithStatusTransition(
      job.id,
      job.currentStatus,
      'awaiting_customer_approval',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({
            finalComponentsCost: finalComponentsCost.toString(),
            serviceChargeApplied: serviceCharge.chargeAmount,
            currentStatus: 'awaiting_customer_approval',
            updatedAt: new Date(),
          })
          .where(eq(jobs.id, jobId))
          .returning();
        return result;
      },
      req.user?.userId,
    );

    return res.status(200).json({
      message: 'Final quote generated successfully. Awaiting customer approval.',
      job: updatedJob,
    });

  } catch (error) {
    console.error('Final Quote Error:', error);
    return res.status(500).json({ error: 'Internal server error while generating quote' });
  }
};



// GET: Fetch all jobs waiting for CS to generate a final quote
export const getPendingFinalQuotes = async (req: Request, res: Response) => {
  try {
    const pendingQuotes = await db.select()
      .from(jobs)
      .where(eq(jobs.currentStatus, 'pending_final_quote'))
      .orderBy(desc(jobs.updatedAt)); // Shows the most recently requested quotes first

    return res.status(200).json({ 
      count: pendingQuotes.length,
      jobs: pendingQuotes 
    });
  } catch (error) {
    console.error('Fetch pending quotes error:', error);
    return res.status(500).json({ error: 'Internal server error while fetching pending quotes' });
  }
};



export const closeJobRequest = async (req: Request, res: Response) => {
  try {
    const { jobId, closingRemarks } = req.body;
    const csUserId = req.user?.userId!;

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Ensure the job is in a state that allows closure
    const allowedClosureStates = ['repair_completed', 'repair_rejected', 'cancelled'];
    if (!allowedClosureStates.includes(job.currentStatus)) {
      return res.status(400).json({ 
        error: `Cannot close job. Current status '${job.currentStatus}' must be one of: ${allowedClosureStates.join(', ')}` 
      });
    }

    // 1. Update job status to closed
    const updatedJob = await updateJobWithStatusTransition(
      job.id,
      job.currentStatus,
      'closed',
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ currentStatus: 'closed', updatedAt: new Date() })
          .where(eq(jobs.id, jobId))
          .returning();
        return result;
      },
      csUserId,
    );

    // 2. If CS provided closing remarks, insert them into the new comments table
    if (closingRemarks) {
      await db.insert(jobComments).values({
        jobId: job.id,
        userId: csUserId,
        comment: `[Job Closed]: ${closingRemarks}`
      });
    }

    return res.status(200).json({
      message: 'Job successfully closed.',
      job: updatedJob,
    });

  } catch (error) {
    console.error('Job closure error:', error);
    return res.status(500).json({ error: 'Internal server error while closing job' });
  }
};
export const getAllJobsWaitingToBeClosed= async(req: Request, res:Response)=>{
  try{
  const csUserId = req.user?.userId!;
  const data= await db.select().from(jobs).where(eq(jobs.currentStatus,'repair_completed'));
  return res.status(200).json({
    message:'Completed Job Fetch Successfully.',
    job:data,
  });
  }catch(error){
    console.error('Job Fetch error',error);
    return res.status(500).json({error:"Cannot Fetch Jobs with complete reapir status"});
  }
}


export const getallJobsWaitingForCSApproval = async (req: Request, res: Response) => {
  try{
    const jobsWaitingForCSApproval = await db.select()
      .from(jobs)
      .where(eq(jobs.currentStatus, 'pending_cs_verification'))
      .orderBy(desc(jobs.updatedAt));

    return res.status(200).json({
      count: jobsWaitingForCSApproval.length,
      jobs: jobsWaitingForCSApproval
    });
  }catch(error){
    console.error('Error fetching jobs waiting for CS approval:', error);
    return res.status(500).json({ error: 'Internal server error while fetching jobs' });
  }
}