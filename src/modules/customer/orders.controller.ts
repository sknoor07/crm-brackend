import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { Request, Response } from 'express';

import { db } from '../../config/database.js';
import {
  customerProfiles,
  jobItems,
  jobs,
  users,
  type JobItemStatus,
} from '../../db/schema/index.js';

export const getCustomerOrders = async (
  req: Request,
  res: Response,
) => {
  try {
    const customerId = req.user?.userId;

    if (!customerId) {
      return res.status(401).json({
        success: false,
        error: 'Authenticated customer is required',
      });
    }

    const pageValue = Number(req.query.page ?? 1);
    const limitValue = Number(req.query.limit ?? 20);
    const page = Number.isFinite(pageValue)
      ? Math.max(Math.trunc(pageValue), 1)
      : 1;
    const limit = Number.isFinite(limitValue)
      ? Math.min(Math.max(Math.trunc(limitValue), 1), 100)
      : 20;
    const offset = (page - 1) * limit;
    const status = String(req.query.status ?? '').trim();

    const filters: SQL[] = [
      eq(jobs.customerId, customerId),
    ];
    if (status) {
      filters.push(
        eq(jobItems.currentStatus, status as JobItemStatus),
      );
    }

    const where = and(...filters);

    const rows = await db
      .select({
        jobId: jobs.id,
        jobNumber: jobs.jobNumber,
        deviceCategory: jobItems.deviceCategory,
        issueDescription: jobItems.issueDescription,
        currentStatus: jobItems.currentStatus,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        customerFirstName: customerProfiles.firstName,
        customerLastName: customerProfiles.lastName,
        customerEmail: users.email,
      })
      .from(jobs)
      .innerJoin(jobItems, eq(jobItems.jobId, jobs.id))
      .innerJoin(users, eq(users.id, jobs.customerId))
      .leftJoin(
        customerProfiles,
        eq(customerProfiles.userId, jobs.customerId),
      )
      .where(where)
      .orderBy(desc(jobs.updatedAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(jobs)
      .innerJoin(jobItems, eq(jobItems.jobId, jobs.id))
      .where(where);

    return res.status(200).json({
      success: true,
      data: {
        items: rows.map((row) => ({
          ...row,
          customerName: [row.customerFirstName, row.customerLastName]
            .filter(Boolean)
            .join(' ') || row.customerEmail,
        })),
        pagination: {
          page,
          limit,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / limit),
        },
      },
    });
  } catch (error) {
    console.error('getCustomerOrders error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load customer orders',
    });
  }
};
