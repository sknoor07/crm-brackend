export const getRepeatRepairLevel = (claimCount) => {
    if (claimCount >= 3)
        return "high";
    if (claimCount === 2)
        return "warning";
    return "normal";
};
export const getWarrantyStatus = (warrantyEnd, currentStatus) => {
    if (currentStatus !== "active") {
        return currentStatus;
    }
    if (new Date() > warrantyEnd) {
        return "expired";
    }
    return "active";
};
export const generateWarrantyClaimNumber = (sequence) => {
    const year = new Date().getFullYear();
    return `WC-${year}-${String(sequence).padStart(6, "0")}`;
};
