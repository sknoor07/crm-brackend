export type WarrantyStatus =
  | "active"
  | "expired"
  | "void"
  | "completed";

export interface WarrantyListFilters {
  status?: WarrantyStatus ;
  customerId?: string;
  jobId?: string;
  jobItemId?: string;
  deviceSerialNumber?: string;
  componentName?: string;
  page: number;
  limit: number;
}