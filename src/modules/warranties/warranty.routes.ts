import { Router } from "express";
import { createClaim, getWarrantyInfoUsingJobID, getWarrantyList, updateClaimInspection } from "./warranty.controller.js";
import { claimIdParamSchema, jobIdParamSchema, warrantyIdParamSchema } from "./warranty.validation.js";
import { validateRequest } from "../../shared/middleware/validateRequest.js";
import { requireAuth, requireRole } from "../../shared/middleware/auth.js";

const router = Router();
router.use(requireAuth);
const csRoles = [
  'customer_service',
];
router.post("/:warrantyId/claims",validateRequest(warrantyIdParamSchema,"params"),requireRole(csRoles),createClaim,);
router.patch("/claims/:claimId/inspection",validateRequest(claimIdParamSchema,"params"),updateClaimInspection,);

router.get("/:jobId",validateRequest(jobIdParamSchema,"params"),getWarrantyInfoUsingJobID);

router.get("/", getWarrantyList);



export default router;