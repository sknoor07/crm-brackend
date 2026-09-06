import { Request, Response } from 'express';
import { asc, eq, or } from 'drizzle-orm';
import crypto from 'crypto';

import {
  hashPassword,
} from '../../shared/utils/password.js';

import { db } from '../../config/database.js';

import {
  users,
  customerProfiles,
  jobs,
  jobItems,
  jobComments,
  jobStatusHistory,
  jobItemStatusHistory,
  accountInvitations,
  deviceServiceCharges,
} from '../../db/schema/index.js';

import {
  CreateJobInput,
} from './jobs.validation.js';

import {
  generateJobNumber,
} from '../../shared/utils/jobNumber.js';
import {
  buildQuoteLineValues,
  insertJobItemQuoteWithLines,
  moneyString,
  resolveQuoteComponents,
} from './quote-components.js';

export const getDeviceCategories = async (
  req: Request,
  res: Response,
) => {
  try {
    const categories = await db
      .select({
        value:
          deviceServiceCharges.deviceCategory,
        serviceCharge:
          deviceServiceCharges.chargeAmount,
      })
      .from(deviceServiceCharges)
      .orderBy(
        asc(deviceServiceCharges.deviceCategory),
      );

    return res.status(200).json({
      categories,
    });
  } catch (error) {
    console.error(
      'Fetch device categories error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while fetching device categories',
    });
  }
};

export const createJobByCS = async (
  req: Request<{}, {}, CreateJobInput>,
  res: Response,
) => {
  try {
    const {
      customerEmail,
      customerPhone,
      customerFirstName,
      customerLastName,
      deviceCategory,
      deviceSerialNumber,
      issueDescription,
      estimatedComponentsCost,
      estimatedComponents,
      billingAddress,
      comment,
    } = req.body;

    const changedBy = req.user?.userId;

    if (!changedBy) {
      return res.status(401).json({
        error: 'Authenticated user not found',
      });
    }

    // --------------------------------------------------
    // 1. Verify device category exists
    // --------------------------------------------------

    const [configuredCategory] = await db
      .select({
        deviceCategory:
          deviceServiceCharges.deviceCategory,
        chargeAmount:
          deviceServiceCharges.chargeAmount,
      })
      .from(deviceServiceCharges)
      .where(
        eq(
          deviceServiceCharges.deviceCategory,
          deviceCategory,
        ),
      )
      .limit(1);

    if (!configuredCategory) {
      return res.status(400).json({
        error: `Invalid device category: ${deviceCategory}`,
      });
    }

    // --------------------------------------------------
    // 2. Generate customer invitation token
    // --------------------------------------------------

    const invitationToken =
      crypto.randomBytes(32).toString('hex');

    const invitationHash =
      crypto
        .createHash('sha256')
        .update(invitationToken)
        .digest('hex');

    // --------------------------------------------------
    // 3. Create Job + Job Item atomically
    // --------------------------------------------------

    const result = await db.transaction(
      async (tx) => {
        // ----------------------------------------------
        // Find existing customer
        // ----------------------------------------------

        const [existingCustomer] =
          await tx
            .select({
              id: users.id,
              email: users.email,
            })
            .from(users)
            .where(
              or(
                eq(users.email, customerEmail),
                eq(users.phone, customerPhone),
              ),
            )
            .limit(1);

        let customerId: string;
        let shouldInvite = false;

        // ----------------------------------------------
        // Existing customer
        // ----------------------------------------------

        if (existingCustomer) {
          customerId = existingCustomer.id;

          await tx
            .update(users)
            .set({
              email: customerEmail,
              phone: customerPhone,
            })
            .where(
              eq(
                users.id,
                customerId,
              ),
            );
        }

        // ----------------------------------------------
        // New customer
        // ----------------------------------------------

        else {
          const hashedPassword = crypto.randomBytes(
            32,
          ).toString('hex');

          const passwordHash =
            await import(
              '../../shared/utils/password.js'
            ).then(({ hashPassword }) =>
              hashPassword(hashedPassword),
            );

          const [newCustomer] =
            await tx
              .insert(users)
              .values({
                email: customerEmail,
                passwordHash,
                phone: customerPhone,
                userType: 'customer',
                mustChangePassword: true,
              })
              .returning({
                id: users.id,
              });

          customerId = newCustomer.id;
          shouldInvite = true;
        }

        // ----------------------------------------------
        // Customer profile
        // ----------------------------------------------

        await tx
          .insert(customerProfiles)
          .values({
            userId: customerId,
            firstName: customerFirstName,
            lastName: customerLastName,
            phone: customerPhone,
            billingAddress,
          })
          .onConflictDoUpdate({
            target: customerProfiles.userId,
            set: {
              firstName: customerFirstName,
              lastName: customerLastName,
              phone: customerPhone,
              billingAddress,
            },
          });

        // ----------------------------------------------
        // Create Job
        // ----------------------------------------------

        const jobId = crypto.randomUUID();

        const jobNumber =
          generateJobNumber();

        const [createdJob] =
          await tx
            .insert(jobs)
            .values({
              id: jobId,
              jobNumber,
              customerId,

              currentStatus: 'in_progress',
            })
            .returning();

        // ----------------------------------------------
        // Create Job Item
        // ----------------------------------------------

        const estimateComponents = resolveQuoteComponents(
          estimatedComponents,
          estimatedComponentsCost,
        );

        if (!estimateComponents) {
          throw new Error(
            'Estimated components are required',
          );
        }

        const estimatedCost = moneyString(
          buildQuoteLineValues('estimate', estimateComponents)
            .componentsCost,
        );

        const [createdJobItem] =
          await tx
            .insert(jobItems)
            .values({
              jobId,

              deviceCategory,

              deviceSerialNumber:
                deviceSerialNumber || null,

              issueDescription,

              estimatedComponentsCost: estimatedCost,

              currentStatus:
                'pending_cs_verification',
            })
            .returning();

        await insertJobItemQuoteWithLines(tx, {
          jobItemId: createdJobItem.id,
          version: 1,
          components: estimateComponents,
          serviceCharge: configuredCategory.chargeAmount,
          createdByUserId: changedBy,
          status: 'estimate',
        });

        // ----------------------------------------------
        // Job status history
        // ----------------------------------------------

        await tx
          .insert(jobStatusHistory)
          .values({
            jobId,

            previousStatus: null,

            newStatus:
              'in_progress',

            changedBy,

            note: comment,
          });

        // ----------------------------------------------
        // Job item status history
        // ----------------------------------------------

        await tx
          .insert(jobItemStatusHistory)
          .values({
            jobItemId:
              createdJobItem.id,

            previousStatus: null,

            newStatus:
              'pending_cs_verification',

            changedBy,

            note: comment,
          });

        // ----------------------------------------------
        // Initial job comment
        // ----------------------------------------------

        await tx
          .insert(jobComments)
          .values({
            jobId,

            userId: changedBy,

            comment,
          });

        // ----------------------------------------------
        // Customer invitation
        // ----------------------------------------------

        if (shouldInvite) {
          const expiresAt =
            new Date(
              Date.now() +
                24 * 60 * 60 * 1000,
            );

          await tx
            .insert(accountInvitations)
            .values({
              userId: customerId,
              tokenHash: invitationHash,
              expiresAt,
            });
        }

        return {
          createdJob,
          createdJobItem,
          shouldInvite,
        };
      },
    );

    // --------------------------------------------------
    // Response
    // --------------------------------------------------

    return res.status(201).json({
      message:
        'Job created successfully by Customer Service',

      job: result.createdJob,

      item: result.createdJobItem,

      ...(result.shouldInvite
        ? {
            invitationToken,
          }
        : {}),
    });
  } catch (error) {
    console.error(
      'Job Creation Error:',
      error,
    );

    return res.status(500).json({
      error:
        'Internal server error while creating job',
    });
  }
};