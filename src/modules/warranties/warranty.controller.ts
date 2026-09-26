import { Request, Response } from "express";
import { createWarrantyClaim, getWarranties, getWarrantyByJobId, updateWarrantyClaimInspection } from "./warranty.service.js";
import { createWarrantyClaimSchema, updateWarrantyClaimInspectionSchema } from "./warranty.validation.js";

export const getWarrantyInfoUsingJobID = async (
  req: Request<{jobId:string}>,
  res: Response,
) => {
  try {
    const jobId = req.params.jobId;

    const warranty = await getWarrantyByJobId(jobId);

    if (!warranty) {
      return res.status(404).json({
        status: "error",
        error: "Warranty not found",
      });
    }

    return res.status(200).json({
      status: "success",
      data: warranty,
    });
  } catch (error) {
    console.error("Get warranty error:", error);

    return res.status(500).json({
      status: "error",
      error: "Internal server error",
    });
  }
};


export const getWarrantyList = async (
  req: Request,
  res: Response,
) => {
  try {
    const filters = req.query;

    const result = await getWarranties({
      status:
        typeof filters.status === "string"
          ? (filters.status as Parameters<typeof getWarranties>[0]["status"])
          : undefined,

      customerId:
        typeof filters.customerId === "string"
          ? filters.customerId
          : undefined,

      jobId:
        typeof filters.jobId === "string"
          ? filters.jobId
          : undefined,

      jobItemId:
        typeof filters.jobItemId === "string"
          ? filters.jobItemId
          : undefined,

      deviceSerialNumber:
        typeof filters.deviceSerialNumber ===
        "string"
          ? filters.deviceSerialNumber
          : undefined,

      componentName:
        typeof filters.componentName === "string"
          ? filters.componentName
          : undefined,

      page:
        typeof filters.page === "string"
          ? Number(filters.page)
          : 1,

      limit:
        typeof filters.limit === "string"
          ? Number(filters.limit)
          : 20,
    });

    return res.status(200).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    console.error(
      "Get warranties error:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error: "Internal server error",
    });
  }
};


export const createClaim = async (req: Request<{warrantyId:string}>,res: Response,) => {
  try {
    const  warrantyId  = req.params.warrantyId;
    const userId =<string> req.user?.userId;
    if(!userId){
      res.status(401).json({message:"Unauthorised Accesss"});
    }

    const parsed = createWarrantyClaimSchema.safeParse(
      req.body,
    );

    if (!parsed.success) {
      return res.status(400).json({
        status: "error",
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
    }

    const result = await createWarrantyClaim(
      warrantyId,
      parsed.data,
      userId,
    );

    return res.status(201).json({
      status: "success",
      data: result,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "WARRANTY_NOT_FOUND") {
        return res.status(404).json({
          status: "error",
          error: "Warranty not found",
        });
      }

      if (error.message === "WARRANTY_NOT_ACTIVE") {
        return res.status(400).json({
          status: "error",
          error: "Warranty is not active",
        });
      }
    }

    console.error("Create warranty claim error:", error);

    return res.status(500).json({
      status: "error",
      error: "Internal server error",
    });
  }
};

export const updateClaimInspection = async (
  req: Request<{claimId:string}>,
  res: Response,
) => {
  try {
    const  claimId = req.params.claimId;

    // 1. Validate body
    const parsed =
      updateWarrantyClaimInspectionSchema.safeParse(
        req.body,
      );

    if (!parsed.success) {
      return res.status(400).json({
        status: "error",
        error: "Validation failed",
        details: parsed.error.flatten(),
      });
    }

    // 2. Update inspection
    const claim =
      await updateWarrantyClaimInspection(
        claimId,
        parsed.data,
      );

    return res.status(200).json({
      status: "success",
      data: {
        claim,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "CLAIM_NOT_FOUND") {
        return res.status(404).json({
          status: "error",
          error: "Warranty claim not found",
        });
      }

      if (error.message === "CLAIM_NOT_OPEN") {
        return res.status(400).json({
          status: "error",
          error:
            "Only an open claim can be inspected",
        });
      }
    }

    console.error(
      "Update warranty claim inspection error:",
      error,
    );

    return res.status(500).json({
      status: "error",
      error: "Internal server error",
    });
  }
};