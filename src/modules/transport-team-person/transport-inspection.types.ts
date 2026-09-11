
export type TransportInspectionDecision =
  | 'onsite'
  | 'lab'
  | 'reject';

export interface TransportInspectionItemInput {
  jobItemId: string;

  /**
   * What should happen to this item after inspection.
   */
  decision: TransportInspectionDecision;

  /**
   * Optional comment about this specific item.
   *
   * Example:
   * "Motherboard needs replacement. Please include it
   * in the final quote."
   */
  comment?: string;
}

export interface TransportInspectionInput {
  jobId: string;

  /**
   * Optional comment about the overall job.
   *
   * Example:
   * "Customer has requested inspection of another device."
   */
  comment?: string;

  /**
   * Inspection decision and optional comment for each item.
   */
  items: TransportInspectionItemInput[];
}
