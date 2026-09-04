import { Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { updateJobWithStatusTransition } from '../jobs/status-history.js';
import { generateJobNumber } from '../../shared/utils/jobNumber.js';
import { db } from '../../config/database.js';
import { jobs, jobComments, deviceServiceCharges } from '../../db/schema/index.js';
import { CreateCustomerJobInput, QuoteResponseInput } from './customer.validation.js';

export const createCustomerJob = async (
  req: Request<{}, {}, CreateCustomerJobInput>,
  res: Response
) => {
  try {
    const { deviceCategory, issueDescription } = req.body;
    const customerId = req.user?.userId;

    if (!customerId) {
      return res.status(401).json({ error: 'Authenticated customer is required' });
    }

    const [configuredCategory] = await db
      .select({ deviceCategory: deviceServiceCharges.deviceCategory })
      .from(deviceServiceCharges)
      .where(eq(deviceServiceCharges.deviceCategory, deviceCategory))
      .limit(1);

    if (!configuredCategory) {
      return res.status(400).json({ error: `Invalid device category: ${deviceCategory}` });
    }

    const jobNumber = generateJobNumber();

    const jobId = crypto.randomUUID();
    const newJob = await updateJobWithStatusTransition(
      jobId,
      null,
      'pending_cs_verification',
      async (tx) => {
        const [result] = await tx.insert(jobs).values({
          id: jobId,
          jobNumber,
          customerId,
          deviceCategory,
          issueDescription,
          currentStatus: 'pending_cs_verification',
        }).returning();
        return result;
      },
      customerId,
    );

    return res.status(201).json({
      message: 'Repair request submitted successfully. It is awaiting CS verification.',
      job: newJob,
    });
  } catch (error) {
    console.error('Customer Job Creation Error:', error);
    return res.status(500).json({ error: 'Internal server error while creating repair request' });
  }
};

export const respondToQuote = async (req: Request<{}, {}, QuoteResponseInput>, res: Response) => {
  try {
    const { jobId, decision } = req.body;
    const userId = req.user?.userId!; // Could be the customer themselves or a CS agent doing it on their behalf

    // 1. Find the job
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const roles = req.user?.roles || [];
    if (roles.includes('customer') && job.customerId !== userId) {
      return res.status(403).json({ error: 'You can only respond to quotes for your own jobs' });
    }

    if (job.currentStatus !== 'awaiting_customer_approval') {
      return res.status(400).json({ error: `Cannot respond to quote. Job is currently in '${job.currentStatus}' state.` });
    }

    // 2. Determine the new status based on the decision
    const newStatus = decision === 'accept' ? 'repair_in_progress' : 'repair_rejected';

    // 3. Update the job
    const updatedJob = await updateJobWithStatusTransition(
      job.id,
      job.currentStatus,
      newStatus,
      async (tx) => {
        const [result] = await tx.update(jobs)
          .set({ currentStatus: newStatus, updatedAt: new Date(), isFinalQuoteApproved:true })
          .where(eq(jobs.id, jobId))
          .returning();
        return result;
      },
      userId,
    );

    // 4. Log the decision in the comments audit trail
    await db.insert(jobComments).values({
      jobId: job.id,
      userId: userId,
      comment: `[System Update]: Customer ${decision}ed the final quote.`
    });

    return res.status(200).json({
      message: `Quote ${decision}ed successfully.`,
      job: updatedJob,
    });

  } catch (error) {
    console.error('Quote response error:', error);
    return res.status(500).json({ error: 'Internal server error while responding to quote' });
  }
};