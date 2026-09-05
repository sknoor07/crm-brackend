import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { Request, Response } from 'express';

import { db } from '../../config/database.js';
import {
  customerProfiles,
  jobItems,
  jobs,
  users,
} from '../../db/schema/index.js';

const staffRoles = new Set([
  'admin',
  'customer_service',
  'transport_manager',
  'transport_team_person',
  'repair_manager',
  'repair_person',
]);

const roleFilter = (req: Request) => {
  const userId = req.user?.userId;
  const roles = req.user?.roles ?? [];

  if (roles.some((role) => staffRoles.has(role))) {
    return undefined;
  }

  return userId ? eq(jobs.customerId, userId) : undefined;
};

export const getDashboardSummary = async (
  req: Request,
  res: Response,
) => {
  try {
    const filter = roleFilter(req);
    const where = filter ? and(filter) : undefined;

    const rows = await db
      .select({
        status: jobItems.currentStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(jobItems)
      .innerJoin(jobs, eq(jobItems.jobId, jobs.id))
      .where(where)
      .groupBy(jobItems.currentStatus);

    const counts = Object.fromEntries(
      rows.map((row) => [row.status, Number(row.count)]),
    );

    const total = rows.reduce(
      (sum, row) => sum + Number(row.count),
      0,
    );

    const completed =
      (counts.repair_completed ?? 0) +
      (counts.delivered ?? 0) +
      (counts.closed ?? 0);

    const readyForDelivery =
      (counts.out_for_delivery ?? 0) +
      (counts.delivered ?? 0);

    return res.status(200).json({
      success: true,
      data: {
        queue: {
          pendingCsVerification:
            counts.pending_cs_verification ?? 0,
          pendingTransportAssignment:
            (counts.ready_for_pickup ?? 0) +
            (counts.pending_pickup ?? 0),
          repairInProgress: counts.repair_in_progress ?? 0,
          readyForDelivery,
        },
        workflowHealth: {
          initialVerificationPercent: total
            ? Math.round(
                (((counts.pending_cs_verification ?? 0) === 0
                  ? total
                  : total - (counts.pending_cs_verification ?? 0)) /
                  total) *
                  100,
              )
            : 0,
          transportHandoffPercent: total
            ? Math.round(
                (((counts.in_transit_to_lab ?? 0) +
                  (counts.arrived_at_lab ?? 0) +
                  (counts.in_lab_diagnosis ?? 0) +
                  completed) /
                  total) *
                  100,
              )
            : 0,
          repairCompletionPercent: total
            ? Math.round((completed / total) * 100)
            : 0,
          deliveryClosurePercent: total
            ? Math.round(
                (((counts.delivered ?? 0) +
                  (counts.closed ?? 0)) /
                  total) *
                  100,
              )
            : 0,
        },
        criticalBlockers: 0,
        period: 'all_time',
      },
    });
  } catch (error) {
    console.error('getDashboardSummary error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load dashboard summary',
    });
  }
};

export const getRecentJobs = async (
  req: Request,
  res: Response,
) => {
  try {
    const limitValue = Number(req.query.limit ?? 10);
    const limit = Number.isFinite(limitValue)
      ? Math.min(Math.max(Math.trunc(limitValue), 1), 50)
      : 10;

    const customerFilter = roleFilter(req);
    const search = String(req.query.search ?? '').trim();
    const searchFilter = search
      ? ilike(jobs.jobNumber, `%${search}%`)
      : undefined;

    const where = customerFilter && searchFilter
      ? and(customerFilter, searchFilter)
      : customerFilter ?? searchFilter;

    const items = await db
      .select({
        id: jobs.id,
        jobNumber: jobs.jobNumber,
        customerId: jobs.customerId,
        customerFirstName: customerProfiles.firstName,
        customerLastName: customerProfiles.lastName,
        customerEmail: users.email,
        deviceCategory: jobItems.deviceCategory,
        currentStatus: jobItems.currentStatus,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
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
      .limit(limit);

    return res.status(200).json({
      success: true,
      data: {
        items: items.map((item) => ({
          ...item,
          customer: {
            id: item.customerId,
            name: [item.customerFirstName, item.customerLastName]
              .filter(Boolean)
              .join(' ') || item.customerEmail,
            email: item.customerEmail,
          },
        })),
        total: items.length,
      },
    });
  } catch (error) {
    console.error('getRecentJobs error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load recent jobs',
    });
  }
};
