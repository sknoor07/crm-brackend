import type { WarrantyStatus } from "./warranty.types.js";
export type RepeatRepairLevel =
  | "normal"
  | "warning"
  | "high";

export const getRepeatRepairLevel = (
  claimCount: number,
): RepeatRepairLevel => {
  if (claimCount >= 3) return "high";
  if (claimCount === 2) return "warning";
  return "normal";
};


export const getWarrantyStatus = (
  warrantyEnd: Date,
  currentStatus: WarrantyStatus,
): WarrantyStatus => {
  if (currentStatus !== "active") {
    return currentStatus;
  }

  if (new Date() > warrantyEnd) {
    return "expired";
  }

  return "active";
};

export const generateWarrantyClaimNumber = (
  sequence: number,
) => {
  const year = new Date().getFullYear();

  return `WC-${year}-${String(sequence).padStart(6, "0")}`;
};