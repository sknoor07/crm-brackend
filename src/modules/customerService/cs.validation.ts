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


export const generateFinalQuoteSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),

  items: z.array(
    z.object({
      jobItemId: z.string().uuid(
        'Invalid job item ID format',
      ),

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
        .min(
          1,
          'Issue description is required',
        )
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

      /*
       * Existing item:
       *
       * undefined -> preserve previous components
       * []        -> remove all components
       * [...]     -> replace with new components
       */
      components: z
        .array(
          z.object({
            name: z
              .string()
              .trim()
              .min(
                1,
                'Component name is required',
              ),

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
        .optional(),

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

  addedItems: z
    .array(
      z.object({
        deviceCategory: z
          .string()
          .trim()
          .min(
            1,
            'Device category is required',
          )
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
          .min(
            1,
            'Issue description is required',
          ),

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

  removedItemIds: z
    .array(
      z.string().uuid(
        'Invalid job item ID format',
      ),
    )
    .default([]),

  comment: z
    .string()
    .trim()
    .min(
      1,
      'Comment is required',
    )
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
  z.infer<
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