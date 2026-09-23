import { pgEnum } from 'drizzle-orm/pg-core';
export const gstType = pgEnum('gst_type', [
    'none',
    'intra_state',
    'inter_state',
]);
