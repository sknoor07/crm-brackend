export type TransportInspectionDecision =
  | 'onsite'
  | 'lab'
  | 'reject';

export interface TransportInspectionComponentInput {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface TransportInspectionItemInput {
  jobItemId: string;
  decision: TransportInspectionDecision;

  /**
   * Components can be edited while the technician
   * is inspecting the item.
   */
  components?: TransportInspectionComponentInput[];

  /**
   * Optional item-specific inspection comment.
   */
  comment?: string;
}

export interface TransportInspectionInput {
  jobId: string;

  /**
   * Optional overall inspection comment.
   */
  comment?: string;

  /**
   * Every item belonging to the job should be
   * included in the inspection request.
   */
  items: TransportInspectionItemInput[];
}