import { z } from 'zod';

// --------------------------------------------------
// Component
// --------------------------------------------------

export const estimatedComponentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Component name is required'),

  quantity: z
    .number()
    .int()
    .positive('Quantity must be greater than 0'),

  unitPrice: z
    .number()
    .nonnegative('Unit price cannot be negative'),
});
export type QuoteComponentInput = z.infer<typeof estimatedComponentSchema>;
export type EstimatedComponentInput = z.infer<
  typeof estimatedComponentSchema
>;

// --------------------------------------------------
// CS decision for individual job item
// --------------------------------------------------

export const csApproveJobItemSchema = z
  .object({
    jobItemId: z
      .string()
      .uuid('Invalid job item ID'),

    decision: z.enum([
      'approved',
      'rejected',
    ]),

    comment: z
      .string()
      .trim()
      .min(1, 'Comment is required')
      .max(
        2000,
        'Comment cannot exceed 2000 characters',
      ),

    estimatedComponents: z
      .array(estimatedComponentSchema)
      .default([]),
  })

  .superRefine((item, ctx) => {
    if (
      item.decision === 'approved' &&
      item.estimatedComponents.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedComponents'],
        message:
          'Estimated components are required for an approved item',
      });
    }

    if (
      item.decision === 'rejected' &&
      item.estimatedComponents.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['estimatedComponents'],
        message:
          'Rejected items cannot have estimated components',
      });
    }
  });

export type CSApproveJobItemInput = z.infer<
  typeof csApproveJobItemSchema
>;

// --------------------------------------------------
// Complete CS job approval request
// --------------------------------------------------

export const csApproveJobAndJobItemSchema = z.object({
  jobId: z
    .string()
    .uuid('Invalid job ID'),

  comment: z
    .string()
    .trim()
    .min(1, 'Job comment is required')
    .max(
      2000,
      'Job comment cannot exceed 2000 characters',
    ),

  items: z
    .array(csApproveJobItemSchema)
    .min(
      1,
      'At least one job item is required',
    ),
});

export type CSApproveJobAndJobItemInput = z.infer<
  typeof csApproveJobAndJobItemSchema
>;

// --------------------------------------------------
// Generate final quote
// --------------------------------------------------

/**
 * Existing job item being included in the final quote.
 *
 * The components array represents the FINAL component
 * list that CS wants for this item.
 *
 * Therefore:
 * - Add component      -> include it
 * - Remove component   -> omit it
 * - Edit component     -> send updated values
 * - Change price       -> send new unitPrice
 */
export const finalQuoteItemSchema = z.object({
  jobItemId: z
    .string()
    .uuid('Invalid job item ID format'),

  components: z
    .array(estimatedComponentSchema)
    .default([]),

  comment: z
    .string()
    .trim()
    .max(
      2000,
      'Item comment cannot exceed 2000 characters',
    )
    .optional(),
});

export type FinalQuoteItemInput = z.infer<
  typeof finalQuoteItemSchema
>;

// --------------------------------------------------
// New item added by CS
// --------------------------------------------------

export const finalQuoteNewItemSchema = z.object({
  deviceCategory: z
    .string()
    .trim()
    .min(1, 'Device category is required')
    .max(
      100,
      'Device category cannot exceed 100 characters',
    ),

  deviceSerialNumber: z
    .string()
    .trim()
    .max(
      50,
      'Device serial number cannot exceed 50 characters',
    )
    .optional(),

  issueDescription: z
    .string()
    .trim()
    .min(1, 'Issue description is required'),

  issueCategory: z
    .string()
    .trim()
    .max(
      50,
      'Issue category cannot exceed 50 characters',
    )
    .optional(),

  repairLocation: z.enum([
    'customer_site',
    'inlab',
  ]),

  components: z
    .array(estimatedComponentSchema)
    .default([]),

  comment: z
    .string()
    .trim()
    .max(
      2000,
      'Item comment cannot exceed 2000 characters',
    )
    .optional(),
});

export type FinalQuoteNewItemInput = z.infer<
  typeof finalQuoteNewItemSchema
>;

// --------------------------------------------------
// Complete CS final quote request
// --------------------------------------------------

export const generateFinalQuoteSchema = z
  .object({
    jobId: z
      .string()
      .uuid('Invalid job ID format'),

    /**
     * Existing items that remain part of
     * the final quote.
     *
     * Their component arrays represent the
     * FINAL component lists.
     */
    items: z
      .array(finalQuoteItemSchema)
      .default([]),

    /**
     * Completely new items added by CS.
     */
    addedItems: z
      .array(finalQuoteNewItemSchema)
      .default([]),

    /**
     * Existing items that CS wants removed.
     *
     * These are not physically deleted.
     * The controller will handle the appropriate
     * status transition and audit trail.
     */
    removedItemIds: z
      .array(
        z.string().uuid(
          'Invalid job item ID format',
        ),
      )
      .default([]),

    /**
     * Job-level comment.
     */
    comment: z
      .string()
      .trim()
      .min(
        1,
        'Job comment is required',
      )
      .max(
        2000,
        'Job comment cannot exceed 2000 characters',
      ),

    /**
     * Discount controlled by CS.
     */
    discount: z
      .number()
      .nonnegative(
        'Discount cannot be negative',
      )
      .default(0),

    /**
     * Tax controlled by CS.
     */
    tax: z
      .number()
      .nonnegative(
        'Tax cannot be negative',
      )
      .default(0),
  })

  // ------------------------------------------------
  // Final quote business rules
  // ------------------------------------------------

  .superRefine((input, ctx) => {
    // ----------------------------------------------
    // Existing item IDs must be unique
    // ----------------------------------------------

    const itemIds = input.items.map(
      (item) => item.jobItemId,
    );

    const uniqueItemIds =
      new Set(itemIds);

    if (
      uniqueItemIds.size !==
      itemIds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message:
          'Duplicate job item IDs are not allowed',
      });
    }

    // ----------------------------------------------
    // Removed item IDs must be unique
    // ----------------------------------------------

    const uniqueRemovedIds =
      new Set(
        input.removedItemIds,
      );

    if (
      uniqueRemovedIds.size !==
      input.removedItemIds.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['removedItemIds'],
        message:
          'Duplicate removed job item IDs are not allowed',
      });
    }

    // ----------------------------------------------
    // An item cannot be kept and removed
    // ----------------------------------------------

    const removedIds =
      new Set(
        input.removedItemIds,
      );

    input.items.forEach(
      (item, index) => {
        if (
          removedIds.has(
            item.jobItemId,
          )
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [
              'items',
              index,
              'jobItemId',
            ],
            message:
              'A job item cannot be included and removed at the same time',
          });
        }
      },
    );

    // ----------------------------------------------
    // Final quote must contain at least one item
    // ----------------------------------------------

    if (
      input.items.length === 0 &&
      input.addedItems.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message:
          'Final quote must contain at least one item',
      });
    }
  });

export type GenerateFinalQuoteInput = z.infer<
  typeof generateFinalQuoteSchema
>;

// --------------------------------------------------
// Get customer details
// --------------------------------------------------

export const csGetCustomerDetail = z.object({
  id: z
    .string()
    .uuid('Invalid customer ID'),
});

export type CsGetCustomerDetail = z.infer<
  typeof csGetCustomerDetail
>;

export const searchCustomerSchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, 'Search query is required'),
});

// --------------------------------------------------
// Close job
// --------------------------------------------------

export const closeJobSchema = z.object({
  jobId: z
    .string()
    .uuid('Invalid job ID format'),

  customerConfirmed: z.literal(
    true,
    'Customer confirmation is required before closing the job',
  ),

  paymentConfirmed: z.literal(
    true,
    {
      message:
        'Payment confirmation is required before closing the job',
    },
  ),

  closureReason: z
    .string()
    .trim()
    .min(
      1,
      'Closing remarks are required',
    )
    .max(
      2000,
      'Closing remarks cannot exceed 2000 characters',
    ),
});

export type CloseJobInput =
  z.infer<typeof closeJobSchema>;