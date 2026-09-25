import { and, count, desc, eq, gte, ilike, inArray, lt } from "drizzle-orm";
import { db } from "../../config/database.js";

import { warranties } from "../../db/schema/warranties.js";
import { warrantyClaims } from "../../db/schema/warranty_claims.js";
import { warrantyClaimItems } from "../../db/schema/warranty_claim_items.js";
import { jobs } from "../../db/schema/jobs.js";
import { jobItems } from "../../db/schema/job-items.js";
import {
    users,
    customerProfiles,
} from "../../db/schema/users.js";
import { jobItemQuoteLines } from "../../db/schema/job-item-quote-lines.js";

import { generateWarrantyClaimNumber, getRepeatRepairLevel, getWarrantyStatus } from "./warranty.helpers.js";
import { WarrantyListFilters } from "./warranty.types.js";
import { CreateWarrantyClaimInput, UpdateWarrantyClaimInspectionInput } from "./warranty.validation.js";

export const getWarrantyById = async (warrantyId: string) => {
    // --------------------------------------------------
    // 1. Warranty
    // --------------------------------------------------

    const [warranty] = await db
        .select()
        .from(warranties)
        .where(eq(warranties.id, warrantyId))
        .limit(1);

    if (!warranty) {
        return null;
    }

    // --------------------------------------------------
    // 2. Original job
    // --------------------------------------------------

    const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, warranty.jobId))
        .limit(1);

    // --------------------------------------------------
    // 3. Original job item
    // --------------------------------------------------

    const [jobItem] = await db
        .select()
        .from(jobItems)
        .where(eq(jobItems.id, warranty.jobItemId))
        .limit(1);

    // --------------------------------------------------
    // 4. Customer user
    // --------------------------------------------------

    let user = null;

    if (job?.customerId) {
        [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, job.customerId))
            .limit(1);
    }

    // --------------------------------------------------
    // 5. Customer profile
    // --------------------------------------------------

    let customerProfile = null;

    if (job?.customerId) {
        [customerProfile] = await db
            .select()
            .from(customerProfiles)
            .where(eq(customerProfiles.userId, job.customerId))
            .limit(1);
    }

    // --------------------------------------------------
    // 6. Quote line
    // --------------------------------------------------

    let quoteLine = null;

    if (warranty.quoteLineId) {
        [quoteLine] = await db
            .select()
            .from(jobItemQuoteLines)
            .where(eq(jobItemQuoteLines.id, warranty.quoteLineId))
            .limit(1);
    }

    // --------------------------------------------------
    // 7. Warranty claims
    // --------------------------------------------------

    const claims = await db
        .select()
        .from(warrantyClaims)
        .where(eq(warrantyClaims.warrantyId, warrantyId))
        .orderBy(warrantyClaims.reportedAt);

    // --------------------------------------------------
    // 8. Claim items
    // --------------------------------------------------

    const claimIds = claims.map((claim) => claim.id);

    const claimItems =
        claimIds.length > 0
            ? await db
                .select()
                .from(warrantyClaimItems)
                .where(
                    inArray(
                        warrantyClaimItems.warrantyClaimId,
                        claimIds,
                    ),
                )
            : [];

    // --------------------------------------------------
    // 9. Get repair jobs for claims
    // --------------------------------------------------

    const repairJobIds = claims
        .map((claim) => claim.repairJobId)
        .filter(
            (id): id is string => id !== null,
        );

    const repairJobs =
        repairJobIds.length > 0
            ? await db
                .select()
                .from(jobs)
                .where(inArray(jobs.id, repairJobIds))
            : [];

    // --------------------------------------------------
    // 10. Build claims response
    // --------------------------------------------------

    const claimsWithDetails = claims.map((claim) => {
        const repairJob =
            claim.repairJobId
                ? repairJobs.find(
                    (job) => job.id === claim.repairJobId,
                ) ?? null
                : null;

        const items = claimItems.filter(
            (item) =>
                item.warrantyClaimId === claim.id,
        );

        return {
            ...claim,
            repairJob,
            items,
        };
    });

    // --------------------------------------------------
    // 11. Effective warranty status
    // --------------------------------------------------

    const effectiveWarrantyStatus =
        getWarrantyStatus(
            warranty.warrantyEnd,
            warranty.warrantyStatus,
        );

    // --------------------------------------------------
    // 12. Claim summary
    // --------------------------------------------------

    const totalClaims =
        claimsWithDetails.length;

    const openClaims =
        claimsWithDetails.filter(
            (claim) =>
                ![
                    "completed",
                    "rejected",
                    "cancelled",
                ].includes(claim.status),
        ).length;

    const completedClaims =
        claimsWithDetails.filter(
            (claim) =>
                claim.status === "completed",
        ).length;

    // --------------------------------------------------
    // 13. Final response
    // --------------------------------------------------

    return {
        warranty: {
            ...warranty,
            warrantyStatus:
                effectiveWarrantyStatus,
        },

        originalJob: job ?? null,

        jobItem: jobItem ?? null,

        customer: user
            ? {
                id: user.id,
                email: user.email,
                phone: user.phone,
                profile: customerProfile,
            }
            : null,

        quoteLine,

        claims: claimsWithDetails,

        summary: {
            totalClaims,
            openClaims,
            completedClaims,
        },
    };
};



export const getWarranties = async (
    filters: WarrantyListFilters,
) => {
    const {
        status,
        customerId,
        jobId,
        jobItemId,
        deviceSerialNumber,
        componentName,
        page,
        limit,
    } = filters;

    const offset = (page - 1) * limit;

    /*
     * Build filters
     */
    const conditions = [];

    if (customerId) {
        conditions.push(
            eq(jobs.customerId, customerId),
        );
    }

    if (jobId) {
        conditions.push(
            eq(warranties.jobId, jobId),
        );
    }

    if (jobItemId) {
        conditions.push(
            eq(warranties.jobItemId, jobItemId),
        );
    }

    if (deviceSerialNumber) {
        conditions.push(
            ilike(
                warranties.deviceSerialNumber,
                `%${deviceSerialNumber}%`,
            ),
        );
    }

    if (componentName) {
        conditions.push(
            ilike(
                warranties.componentName,
                `%${componentName}%`,
            ),
        );
    }
    if (status === "active") {
        conditions.push(
            and(
                eq(warranties.warrantyStatus, "active"),
                gte(warranties.warrantyEnd, new Date()),
            )!,
        );
    }

    if (status === "expired") {
        conditions.push(
            and(
                eq(warranties.warrantyStatus, "active"),
                lt(warranties.warrantyEnd, new Date()),
            )!,
        );
    }

    if (status === "void") {
        conditions.push(
            eq(warranties.warrantyStatus, "void"),
        );
    }

    if (status === "completed") {
        conditions.push(
            eq(warranties.warrantyStatus, "completed"),
        );
    }

    /*
     * Status is slightly different because an active
     * warranty can become expired based on warrantyEnd.
     *
     * Therefore we fetch the rows first and calculate
     * effective status in application code.
     */
    const whereCondition =
        conditions.length > 0
            ? and(...conditions)
            : undefined;

    /*
     * Get total count
     */
    const [{ total }] = await db
        .select({
            total: count(),
        })
        .from(warranties)
        .innerJoin(
            jobs,
            eq(warranties.jobId, jobs.id),
        )
        .where(whereCondition);

    /*
     * Get paginated warranties
     */
    const rows = await db.select({
        warranty: warranties,

        job: {
            id: jobs.id,
            jobNumber: jobs.jobNumber,
            customerId: jobs.customerId,
        },

        jobItem: {
            id: jobItems.id,
            deviceName: jobItems.deviceName,
            deviceCategory: jobItems.deviceCategory,
            deviceSerialNumber:
                jobItems.deviceSerialNumber,
        },

        user: {
            id: users.id,
            email: users.email,
            phone: users.phone,
        },

        customerProfile: {
            userId: customerProfiles.userId,
            firstName: customerProfiles.firstName,
            lastName: customerProfiles.lastName,
            phone: customerProfiles.phone,
        },
    }).from(warranties)
        .innerJoin(jobs, eq(warranties.jobId, jobs.id),)
        .innerJoin(jobItems, eq(warranties.jobItemId, jobItems.id),)
        .innerJoin(users, eq(jobs.customerId, users.id),)
        .leftJoin(customerProfiles, eq(users.id, customerProfiles.userId,),)
        .where(whereCondition)
        .limit(limit)
        .offset(offset);

    /*
     * Calculate effective status
     */
    let items = rows.map((row) => ({
        id: row.warranty.id,
        jobId: row.warranty.jobId,
        jobNumber: row.job.jobNumber,

        jobItemId: row.warranty.jobItemId,

        deviceName: row.jobItem.deviceName,
        deviceCategory:
            row.jobItem.deviceCategory,

        deviceSerialNumber:
            row.warranty.deviceSerialNumber,

        deviceImei: row.warranty.deviceImei,

        componentName:
            row.warranty.componentName,

        quantity: row.warranty.quantity,

        warrantyMonths:
            row.warranty.warrantyMonths,

        warrantyStart:
            row.warranty.warrantyStart,

        warrantyEnd:
            row.warranty.warrantyEnd,

        warrantyStatus:
            getWarrantyStatus(
                row.warranty.warrantyEnd,
                row.warranty.warrantyStatus,
            ),

        customer: {
            id: row.user.id,
            email: row.user.email,
            phone: row.user.phone,

            firstName:
                row.customerProfile?.firstName ??
                null,

            lastName:
                row.customerProfile?.lastName ??
                null,
        },

        createdAt:
            row.warranty.createdAt,

        updatedAt:
            row.warranty.updatedAt,
    }));

    return {
        items,

        pagination: {
            page,
            limit,
            total: Number(total),
            totalPages: Math.ceil(
                Number(total) / limit,
            ),
        },
    };
};

export const createWarrantyClaim = async (
  warrantyId: string,
  input: CreateWarrantyClaimInput,
) => {
  // 1. Find warranty
  const [warranty] = await db
    .select()
    .from(warranties)
    .where(eq(warranties.id, warrantyId))
    .limit(1);

  if (!warranty) {
    throw new Error("WARRANTY_NOT_FOUND");
  }

  // 2. Check effective warranty status
  const effectiveStatus = getWarrantyStatus(
    warranty.warrantyEnd,
    warranty.warrantyStatus,
  );

  if (effectiveStatus !== "active") {
    throw new Error("WARRANTY_NOT_ACTIVE");
  }

  // 3. Calculate rolling 30-day claim history
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentClaims = await db
    .select()
    .from(warrantyClaims)
    .where(
      and(
        eq(warrantyClaims.warrantyId, warrantyId),
        gte(warrantyClaims.reportedAt, thirtyDaysAgo),
      ),
    )
    .orderBy(desc(warrantyClaims.reportedAt));

  // Existing claims + the new claim
  const totalRecentClaims = recentClaims.length + 1;

  const repeatRepairLevel =
    getRepeatRepairLevel(totalRecentClaims);

  // 4. Generate claim number
  const [{ total }] = await db
    .select({
      total: count(),
    })
    .from(warrantyClaims);

  const claimNumber = generateWarrantyClaimNumber(
    Number(total) + 1,
  );

  // 5. Create claim
  const [claim] = await db
    .insert(warrantyClaims)
    .values({
      warrantyId,
      claimNumber,
      reasonForReturn: input.reasonForReturn,
      issueCategory: input.issueCategory,
      notes: input.notes ?? null,

      // Technician fills these during inspection
      failureType: null,
      diagnosis: null,

      status: "open",
      warrantyResult: null,

      reportedAt: new Date(),
    })
    .returning();

  return {
    claim,
    repeatRepair: {
      recentClaimCount: totalRecentClaims,
      level: repeatRepairLevel,
      windowDays: 30,
    },
  };
};

export const updateWarrantyClaimInspection = async (
  claimId: string,
  input: UpdateWarrantyClaimInspectionInput,
) => {
  // 1. Find claim
  const [claim] = await db
    .select()
    .from(warrantyClaims)
    .where(eq(warrantyClaims.id, claimId))
    .limit(1);

  if (!claim) {
    throw new Error("CLAIM_NOT_FOUND");
  }

  // 2. Inspection can only start for an open claim
  if (claim.status !== "open") {
    throw new Error("CLAIM_NOT_OPEN");
  }

  // 3. Update inspection details
  const [updatedClaim] = await db
    .update(warrantyClaims)
    .set({
      diagnosis: input.diagnosis,
      failureType: input.failureType,
      notes: input.notes ?? claim.notes,
      status: "under_inspection",
      inspectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(warrantyClaims.id, claimId))
    .returning();

  return updatedClaim;
};