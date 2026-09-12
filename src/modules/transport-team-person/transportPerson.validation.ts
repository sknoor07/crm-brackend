import { z } from 'zod';

export const jobIdParamsSchema = z.object({
  id: z.string().uuid('Invalid job ID format'),
});

export const startTransportJobSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

/**
 * Transport person inspects the entire job in one request.
 *
 * For each item they only decide:
 * - onsite
 * - lab
 * - reject
 *
 * Pricing and components are handled later by CS.
 */
export const completeTransportInspectionSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  /**
   * Optional job-level comment.
   *
   * Used for information that applies to the
   * overall job, such as requesting an item to
   * be added or removed.
   */
  comment: z
    .string()
    .trim()
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    )
    .optional(),

  /**
   * Inspection result for every job item.
   */
  items: z
    .array(
      z.object({
        jobItemId: z.string().uuid(
          'Invalid job item ID format',
        ),

        decision: z.enum([
          'onsite',
          'lab',
          'reject',
        ]),

        /**
         * Optional comment specific to this item.
         */
        comment: z
          .string()
          .trim()
          .max(
            2000,
            'Item comment cannot exceed 2000 characters',
          )
          .optional(),
      }),
    )
    .min(
      1,
      'At least one item inspection is required',
    ),
});

export const requestFinalQuoteSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  /**
   * Optional because a final quote may contain
   * only the service charge.
   */
  requestedComponents: z
    .string()
    .trim()
    .optional(),

  additionalNotes: z
    .string()
    .trim()
    .max(2000, 'Notes cannot exceed 2000 characters')
    .optional(),

  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const generateFinalQuoteSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  /**
   * Existing job items.
   *
   * CS can:
   * - edit item details
   * - add/remove/update components
   * - include the item in the quote
   */
  items: z.array(
    z.object({
      jobItemId: z.string().uuid(
        'Invalid job item ID format',
      ),

      /**
       * Editable job-item information.
       */
      deviceCategory: z
        .string()
        .trim()
        .min(1, 'Device category is required')
        .max(
          100,
          'Device category cannot exceed 100 characters',
        )
        .optional(),

      deviceSerialNumber: z
        .string()
        .trim()
        .max(
          50,
          'Device serial number cannot exceed 50 characters',
        )
        .optional()
        .nullable(),

      issueDescription: z
        .string()
        .trim()
        .min(1, 'Issue description is required')
        .optional(),

      issueCategory: z
        .string()
        .trim()
        .max(
          50,
          'Issue category cannot exceed 50 characters',
        )
        .optional()
        .nullable(),

      repairLocation: z
        .enum([
          'customer_site',
          'inlab',
        ])
        .optional(),

      /**
       * Complete component list for this quote version.
       *
       * Sending a new list replaces the components
       * from the previous quote version.
       */
      components: z
        .array(
          z.object({
            name: z
              .string()
              .trim()
              .min(1, 'Component name is required'),

            quantity: z
              .number()
              .positive(
                'Component quantity must be greater than 0',
              ),

            unitPrice: z
              .number()
              .nonnegative(
                'Component unit price cannot be negative',
              ),
          }),
        )
        .default([]),

      /**
       * Item-level audit comment.
       */
      comment: z
        .string()
        .trim()
        .max(
          2000,
          'Item comment cannot exceed 2000 characters',
        )
        .optional(),
    }),
  ),

  /**
   * New items added by CS while preparing
   * or revising the final quote.
   */
  addedItems: z
    .array(
      z.object({
        deviceCategory: z
          .string()
          .trim()
          .min(1, 'Device category is required')
          .max(100),

        deviceSerialNumber: z
          .string()
          .trim()
          .max(50)
          .optional()
          .nullable(),

        issueDescription: z
          .string()
          .trim()
          .min(1, 'Issue description is required'),

        issueCategory: z
          .string()
          .trim()
          .max(50)
          .optional()
          .nullable(),

        repairLocation: z.enum([
          'customer_site',
          'inlab',
        ]),

        components: z
          .array(
            z.object({
              name: z
                .string()
                .trim()
                .min(1),

              quantity: z
                .number()
                .positive(),

              unitPrice: z
                .number()
                .nonnegative(),
            }),
          )
          .default([]),

        comment: z
          .string()
          .trim()
          .max(2000)
          .optional(),
      }),
    )
    .default([]),

  /**
   * Existing items that CS wants to remove
   * from the quote.
   */
  removedItemIds: z
    .array(
      z.string().uuid(
        'Invalid job item ID format',
      ),
    )
    .default([]),

  /**
   * Job-level audit comment.
   */
  comment: z
    .string()
    .trim()
    .min(1, 'Comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),

  discount: z
    .number()
    .nonnegative(
      'Discount cannot be negative',
    )
    .default(0),

  tax: z
    .number()
    .nonnegative(
      'Tax cannot be negative',
    )
    .default(0),
});

export type GenerateFinalQuoteInput =
  z.infer<typeof generateFinalQuoteSchema>;


export const rejectJobItemSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Rejection comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const finishOnsiteRepairInput = z.object({
  jobId: z.string().uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Repair start comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const completeOnsiteRepairSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Repair completion comment is required')
    .max(2000, 'Comment cannot exceed 2000 characters'),
});

export const startDeliverySchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Delivery start comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export const deliverItemSchema = z.object({
  jobItemId: z.string().uuid('Invalid job item ID format'),

  comment: z
    .string()
    .trim()
    .min(1, 'Delivery comment is required')
    .max(
      2000,
      'Comment cannot exceed 2000 characters',
    ),
});

export type JobIdParamsSchema= z.infer<typeof jobIdParamsSchema>;
export type StartTransportJobInput =
  z.infer<typeof startTransportJobSchema>;

export type CompleteTransportInspectionInput =
  z.infer<typeof completeTransportInspectionSchema>;

export type RequestFinalQuoteInput =
  z.infer<typeof requestFinalQuoteSchema>;

export type RejectJobItemInput =
  z.infer<typeof rejectJobItemSchema>;

export type FinishOnsiteRepairInput =
  z.infer<typeof finishOnsiteRepairInput>;

export type CompleteOnsiteRepairInput =
  z.infer<typeof completeOnsiteRepairSchema>;

export type StartDeliveryInput =
  z.infer<typeof startDeliverySchema>;

export type DeliverItemInput =
  z.infer<typeof deliverItemSchema>;
