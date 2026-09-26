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
import { generateJobNumber } from "../../shared/utils/jobNumber.js";
import { transitionJob } from "../jobstatusandtransitions/transition-job.js";
import { updateJobItemWithStatusTransition } from "../jobstatusandtransitions/item-status-history.js";

export const getWarrantyByJobId = async (jobId: string) => {
    // --------------------------------------------------
    // 1. Warranty
    // --------------------------------------------------

    const warrantiesResult = await db
        .select()
        .from(warranties)
        .where(eq(warranties.jobId, jobId))

    if (!warrantiesResult || warrantiesResult.length === 0) {
        return null;
    }

    // --------------------------------------------------
    // 2. Original job
    // --------------------------------------------------

    const [job] = await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

    // --------------------------------------------------
    // 3. Original job item
    // --------------------------------------------------

    const [jobItem] = await db
        .select()
        .from(jobItems)
        .where(eq(jobItems.jobId, jobId));

    // --------------------------------------------------
    // 4. Customer user
    // --------------------------------------------------

    let user = null;
    let customerProfile = null;

    if (job?.customerId) {
        [user] = await db.select().from(users).where(eq(users.id, job.customerId)).limit(1);
        [customerProfile] = await db.select().from(customerProfiles).where(eq(customerProfiles.userId, job.customerId)).limit(1);
    }



    // --------------------------------------------------
    // 6. Quote line
    // --------------------------------------------------
    const quoteLineIds = warrantiesResult
        .map((w) => w.quoteLineId)
        .filter((id): id is string => id !== null);


    let quoteLines: any = [];
    if (quoteLineIds.length > 0) {
        quoteLines = await db
            .select()
            .from(jobItemQuoteLines)
            .where(inArray(jobItemQuoteLines.id, quoteLineIds));
    }

    // --------------------------------------------------
    // 7. Warranty claims
    // --------------------------------------------------
    const warrantyIds = warrantiesResult.map(row => row.id);
    let claims: any = [];
    if (warrantyIds.length > 0) {
        claims = await db
            .select()
            .from(warrantyClaims)
            .where(inArray(warrantyClaims.warrantyId, warrantyIds))
            .orderBy(warrantyClaims.reportedAt);
    }
    // --------------------------------------------------
    // 8. Claim items
    // --------------------------------------------------
    let claimItems: any = [];
    let repairJobs: any = [];
    let claimsWithDetails = [];

    if (claims.length > 0) {
        const claimIds = claims.map((claim: any) => claim.id);

        claimItems = await db
            .select()
            .from(warrantyClaimItems)
            .where(inArray(warrantyClaimItems.warrantyClaimId, claimIds));

        const repairJobIds = claims
            .map((claim: any) => claim.repairJobId)
            .filter((id: string): id is string => id !== null);

        if (repairJobIds.length > 0) {
            repairJobs = await db
                .select()
                .from(jobs)
                .where(inArray(jobs.id, repairJobIds));
        }
    }



    // --------------------------------------------------
    // 9. Get repair jobs for claims
    // --------------------------------------------------


    // --------------------------------------------------
    // 10. Build claims response
    // --------------------------------------------------
    if (claims.length > 0) {
        claimsWithDetails = claims.map((claim: any) => {
            const repairJob = claim.repairJobId
                ? repairJobs.find((j: any) => j.id === claim.repairJobId) ?? null
                : null;
            const items = claimItems.filter((item: any) => item.warrantyClaimId === claim.id);

            return { ...claim, repairJob, items };
        });
    }



    // --------------------------------------------------
    // 11. Effective warranty status
    // --------------------------------------------------
    let effectiveWarrantyStatus = "expired";
    for (const warranty of warrantiesResult) {
        const status = getWarrantyStatus(warranty.warrantyEnd, warranty.warrantyStatus);
        if (status === "active") {
            effectiveWarrantyStatus = "active";
            break; // If at least one is active, the overall status is active
        }
    }

    // --------------------------------------------------
    // 12. Claim summary
    // --------------------------------------------------
    const totalClaims = claimsWithDetails.length;
    const openClaims = claimsWithDetails.filter(
        (claim: any) => !["completed", "rejected", "cancelled"].includes(claim.status)
    ).length;
    const completedClaims = claimsWithDetails.filter(
        (claim: any) => claim.status === "completed"
    ).length;

    // --------------------------------------------------
    // 13. Final response
    // --------------------------------------------------

    return {
        warranties: warrantiesResult,
        warrantyStatus: effectiveWarrantyStatus,

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

        quoteLine: quoteLines,

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
    userId:string,
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

    

    const id = crypto.randomUUID();
    const jobNumber = generateJobNumber();
    const result = await db.transaction(async (tx) => {
        const [claim] = await tx
        .insert(warrantyClaims)
        .values({
            warrantyId,
            claimNumber,
            reasonForReturn: input.reasonForReturn,
            issueCategory: input.issueCategory,
            notes: input.notes ?? null,
            jobItemId:input.jobItemId,

            // Technician fills these during inspection
            failureType: null,
            diagnosis: null,

            status: "open",
            warrantyResult: null,

            reportedAt: new Date(),
        })
        .returning();

        const [job] = await tx.insert(jobs).values({
            id: id,
            jobNumber,
            customerId: input.customerId,
            currentStatus: 'created',
        }).returning();
        const [existingItem] = await tx
            .select()
            .from(jobItems)
            .where(eq(jobItems.id, input.jobItemId))
            .limit(1);
        if (!existingItem) {
    throw new Error("Original job item not found");
}
const { id: oldId, createdAt, updatedAt, ...restOfItemData } = existingItem;

        const createdJobItems = await tx
            .insert(jobItems)
            .values({ ...restOfItemData, jobId: job.id, issueDescription: input.reasonForReturn, currentStatus: 'created',isWarrantyClaim:true })
            .returning();

        const updatedJob = await transitionJob({
                jobId: job.id,
                previousStatus: 'created',
                newStatus: 'assigning_pickup_Engineer',
                changedBy: userId,
                note: 'claimed opened and job send for pickup',
                comment: input.notes?.trim() ?? "",
                existingTx: tx,
        
                updateJob: async (tx) => {
                  const [updated] = await tx
                    .update(jobs)
                    .set({
                      currentStatus: 'assigning_pickup_Engineer',
                      updatedAt: new Date(),
                    })
                    .where(eq(jobs.id, job.id))
                    .returning();
        
                  return updated;
                },
              });
        const updatedItem =
                  await updateJobItemWithStatusTransition(
                    createdJobItems[0].id,
                    'created',
                    'approved_for_transport',
        
                    async (tx) => {
                      const [updated] = await tx
                        .update(jobItems)
                        .set({
                          currentStatus:
                            'approved_for_transport',
                          updatedAt: new Date(),
                        })
                        .where(eq(jobItems.id, createdJobItems[0].id))
                        .returning();
                        return updated
                    },
                    userId,
                    'claim started for job item and send for transportation',
                    tx,
                );
            return {
                job:updatedJob,
                jobItem:updatedItem,
                claim,
            }
    });

    return {
         claim:result.claim,
        repeatRepair: {
            recentClaimCount: totalRecentClaims,
            level: repeatRepairLevel,
            windowDays: 30,
        },
        job:result.job,
        jobItem:result.jobItem,
       
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