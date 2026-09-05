import {
  and,
  asc,
  eq,
  gte,
  lt,
  sql,
} from 'drizzle-orm';
import { Request, Response } from 'express';

import { db } from '../../config/database.js';
import {
  jobComments,
  jobItemQuotes,
  jobItemStatusHistory,
  jobItems,
  jobStatusHistory,
  jobs,
  roles,
  userRoles,
  users,
  warranties,
} from '../../db/schema/index.js';

const parseDateRange = (value: unknown) => {
  const date = String(value ?? '').trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const selectedDate = datePattern.test(date)
    ? date
    : new Date().toISOString().slice(0, 10);

  const start = new Date(`${selectedDate}T00:00:00.000Z`);
  const end = new Date(`${selectedDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    selectedDate,
    start,
    end,
  };
};

const countBy = <T extends Record<string, unknown>>(
  rows: T[],
  key: keyof T,
) =>
  Object.fromEntries(
    rows.map((row) => [String(row[key]), Number(row.count)]),
  );

export const getAdminAnalytics = async (
  req: Request,
  res: Response,
) => {
  try {
    const { selectedDate, start, end } = parseDateRange(
      req.query.date,
    );
    const startDate = start;
    const endDate = end;

    const [jobsCreated, itemsCreated, commentsCreated] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(jobs)
          .where(
            and(
              gte(jobs.createdAt, startDate),
              lt(jobs.createdAt, endDate),
            ),
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(jobItems)
          .where(
            and(
              gte(jobItems.createdAt, startDate),
              lt(jobItems.createdAt, endDate),
            ),
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(jobComments)
          .where(
            and(
              gte(jobComments.createdAt, startDate),
              lt(jobComments.createdAt, endDate),
            ),
          ),
      ]);

    const [statusRows, transitionRows, hourlyRows] =
      await Promise.all([
        db
          .select({
            status: jobItems.currentStatus,
            count: sql<number>`count(*)::int`,
          })
          .from(jobItems)
          .groupBy(jobItems.currentStatus),
        db
          .select({
            status: jobItemStatusHistory.newStatus,
            count: sql<number>`count(*)::int`,
          })
          .from(jobItemStatusHistory)
          .where(
            and(
              gte(jobItemStatusHistory.createdAt, startDate),
              lt(jobItemStatusHistory.createdAt, endDate),
            ),
          )
          .groupBy(jobItemStatusHistory.newStatus),
        db
          .select({
            hour: sql<string>`to_char(date_trunc('hour', ${jobs.createdAt}), 'HH24:00')`,
            count: sql<number>`count(*)::int`,
          })
          .from(jobs)
          .where(
            and(
              gte(jobs.createdAt, startDate),
              lt(jobs.createdAt, endDate),
            ),
          )
          .groupBy(
            sql`date_trunc('hour', ${jobs.createdAt})`,
          )
          .orderBy(
            asc(sql`date_trunc('hour', ${jobs.createdAt})`),
          ),
      ]);

    const [jobHistoryToday, itemHistoryToday] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(jobStatusHistory)
          .where(
            and(
              gte(jobStatusHistory.createdAt, startDate),
              lt(jobStatusHistory.createdAt, endDate),
            ),
          ),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(jobItemStatusHistory)
          .where(
            and(
              gte(jobItemStatusHistory.createdAt, startDate),
              lt(jobItemStatusHistory.createdAt, endDate),
            ),
          ),
      ]);

    const [quotesToday, quoteStatuses, quoteTotals] =
      await Promise.all([
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(jobItemQuotes)
          .where(
            and(
              gte(jobItemQuotes.createdAt, startDate),
              lt(jobItemQuotes.createdAt, endDate),
            ),
          ),
        db
          .select({
            status: jobItemQuotes.status,
            count: sql<number>`count(*)::int`,
          })
          .from(jobItemQuotes)
          .where(
            and(
              gte(jobItemQuotes.createdAt, startDate),
              lt(jobItemQuotes.createdAt, endDate),
            ),
          )
          .groupBy(jobItemQuotes.status),
        db
          .select({
            quotedAmount: sql<string>`coalesce(sum(${jobItemQuotes.totalAmount}), 0)`,
            approvedAmount: sql<string>`coalesce(sum(case when ${jobItemQuotes.customerApproved} = true then ${jobItemQuotes.totalAmount} else 0 end), 0)`,
          })
          .from(jobItemQuotes)
          .where(
            and(
              gte(jobItemQuotes.createdAt, startDate),
              lt(jobItemQuotes.createdAt, endDate),
            ),
          ),
      ]);

    const [assignmentSummary, activeUsersByRole, warrantiesToday] =
      await Promise.all([
        db
          .select({
            pickupAssigned: sql<number>`count(*) filter (where ${jobs.assignedTransportTeamPersonId} is not null)::int`,
            repairManagerAssigned: sql<number>`count(*) filter (where ${jobs.repairManagerId} is not null)::int`,
            deliveryAssigned: sql<number>`count(*) filter (where ${jobs.assignedDeliveryTechId} is not null)::int`,
          })
          .from(jobs),
        db
          .select({
            role: roles.name,
            count: sql<number>`count(distinct ${users.id})::int`,
          })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(eq(users.isActive, true))
          .groupBy(roles.name),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(warranties)
          .where(
            and(
              gte(warranties.createdAt, startDate),
              lt(warranties.createdAt, endDate),
            ),
          ),
      ]);

    const [latestAssignments] = assignmentSummary;
    const [quoteAmount] = quoteTotals;

    return res.status(200).json({
      success: true,
      data: {
        date: selectedDate,
        timezone: 'UTC',
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
        overview: {
          jobsCreated: Number(jobsCreated[0]?.count ?? 0),
          itemsCreated: Number(itemsCreated[0]?.count ?? 0),
          commentsCreated: Number(commentsCreated[0]?.count ?? 0),
          jobStatusTransitions: Number(jobHistoryToday[0]?.count ?? 0),
          itemStatusTransitions: Number(itemHistoryToday[0]?.count ?? 0),
          totalStatusTransitions:
            Number(jobHistoryToday[0]?.count ?? 0) +
            Number(itemHistoryToday[0]?.count ?? 0),
        },
        workflow: {
          currentItemsByStatus: countBy(statusRows, 'status'),
          transitionsByStatusToday: countBy(
            transitionRows,
            'status',
          ),
          jobsCreatedByHour: hourlyRows.map((row) => ({
            hour: row.hour,
            count: Number(row.count),
          })),
        },
        queues: {
          pendingCsVerification:
            Number(statusRows.find((row) => row.status === 'pending_cs_verification')?.count ?? 0),
          pendingFinalQuote:
            Number(statusRows.find((row) => row.status === 'pending_final_quote')?.count ?? 0),
          awaitingCustomerApproval:
            Number(statusRows.find((row) => row.status === 'awaiting_customer_approval')?.count ?? 0),
          repairInProgress:
            Number(statusRows.find((row) => row.status === 'repair_in_progress')?.count ?? 0),
          pendingRepairInspection:
            Number(statusRows.find((row) => row.status === 'pending_repair_manager_inspection')?.count ?? 0),
          readyForDelivery:
            Number(statusRows.find((row) => row.status === 'ready_for_delivery')?.count ?? 0) +
            Number(statusRows.find((row) => row.status === 'out_for_delivery')?.count ?? 0),
        },
        quotes: {
          createdToday: Number(quotesToday[0]?.count ?? 0),
          byStatus: countBy(quoteStatuses, 'status'),
          quotedAmount: Number(quoteAmount?.quotedAmount ?? 0),
          approvedAmount: Number(quoteAmount?.approvedAmount ?? 0),
        },
        assignments: {
          pickupAssigned: Number(latestAssignments?.pickupAssigned ?? 0),
          repairManagerAssigned: Number(latestAssignments?.repairManagerAssigned ?? 0),
          deliveryAssigned: Number(latestAssignments?.deliveryAssigned ?? 0),
        },
        activeUsersByRole: countBy(activeUsersByRole, 'role'),
        warrantiesCreatedToday: Number(warrantiesToday[0]?.count ?? 0),
      },
    });
  } catch (error) {
    console.error('getAdminAnalytics error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to load admin analytics',
    });
  }
};
