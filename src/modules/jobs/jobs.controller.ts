import { Request, Response } from 'express';
import { asc, eq, or } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { users, customerProfiles, jobs, accountInvitations, deviceServiceCharges } from '../../db/schema/index.js';
import { CreateJobInput } from './jobs.validation.js';
import { hashPassword } from '../../shared/utils/password.js';
import crypto from 'crypto';
import { generateJobNumber } from '../../shared/utils/jobNumber.js';
import { jobStatusHistory } from '../../db/schema/index.js';
import { allowedJobTransitions } from './status-history.js';

export const getDeviceCategories = async (req: Request, res: Response) => {
  try {
    const categories = await db
      .select({
        value: deviceServiceCharges.deviceCategory,
        serviceCharge: deviceServiceCharges.chargeAmount,
      })
      .from(deviceServiceCharges)
      .orderBy(asc(deviceServiceCharges.deviceCategory));

    return res.status(200).json({ categories });
  } catch (error) {
    console.error('Fetch device categories error:', error);
    return res.status(500).json({ error: 'Internal server error while fetching device categories' });
  }
};

export const createJobByCS = async (req: Request<{}, {}, CreateJobInput>, res: Response) => {
  try {
    const { 
      customerEmail, 
      customerPhone, 
      customerFirstName, 
      customerLastName, 
      deviceCategory, 
      issueDescription, 
      estimatedComponentsCost,
      billingAddress
    } = req.body;

    const [configuredCategory] = await db
      .select({ deviceCategory: deviceServiceCharges.deviceCategory })
      .from(deviceServiceCharges)
      .where(eq(deviceServiceCharges.deviceCategory, deviceCategory))
      .limit(1);

    if (!configuredCategory) {
      return res.status(400).json({ error: `Invalid device category: ${deviceCategory}` });
    }

    const invitationToken = crypto.randomBytes(32).toString('hex');
    const invitationHash = crypto.createHash('sha256').update(invitationToken).digest('hex');
    const newJob = await db.transaction(async (tx) => {
      const [existingCustomer] = await tx.select({
        id: users.id,
        email: users.email,
      }).from(users).where(or(eq(users.email, customerEmail), eq(users.phone, customerPhone))).limit(1);

      let customerId: string;
      let shouldInvite = false;
      if (existingCustomer) {
        customerId = existingCustomer.id;
        await tx.update(users).set({ email: customerEmail, phone: customerPhone }).where(eq(users.id, customerId));
      } else {
        const hashedPassword = await hashPassword(crypto.randomBytes(32).toString('hex'));
        const [newCustomer] = await tx.insert(users).values({
          email: customerEmail,
          passwordHash: hashedPassword,
          phone: customerPhone,
          userType: 'customer',
          mustChangePassword: true,
        }).returning({ id: users.id });
        customerId = newCustomer.id;
        shouldInvite = true;
      }

      await tx.insert(customerProfiles).values({
        userId: customerId,
        firstName: customerFirstName,
        lastName: customerLastName,
        phone: customerPhone,
        billingAddress,
      }).onConflictDoUpdate({
        target: customerProfiles.userId,
        set: { firstName: customerFirstName, lastName: customerLastName, phone: customerPhone, billingAddress },
      });

      const jobId = crypto.randomUUID();
      const jobNumber = generateJobNumber();
      const [createdJob] = await tx.insert(jobs).values({
        id: jobId,
        jobNumber,
        customerId,
        deviceCategory,
        issueDescription,
        currentStatus: 'ready_for_pickup',
        estimatedComponentsCost: estimatedComponentsCost.toString(),
      }).returning();

      if (!allowedJobTransitions.created.includes('ready_for_pickup')) {
        throw new Error('Invalid initial job status configuration');
      }
      await tx.insert(jobStatusHistory).values({
        jobId,
        previousStatus: null,
        newStatus: 'ready_for_pickup',
        changedBy: req.user?.userId,
      });

      if (shouldInvite) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await tx.insert(accountInvitations).values({
          userId: customerId,
          tokenHash: invitationHash,
          expiresAt,
        });
      }

      return { createdJob, shouldInvite };
    });

    return res.status(201).json({
      message: 'Job created successfully by Customer Service',
      job: newJob.createdJob,
      ...(newJob.shouldInvite ? { invitationToken } : {}),
    });

  } catch (error) {     
    console.error('Job Creation Error:', error);
    return res.status(500).json({ error: 'Internal server error while creating job' });
  }
};