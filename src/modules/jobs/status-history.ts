import {
  JobSummaryStatus,
} from '../../db/schema/index.js';

export const allowedJobTransitions: Record<
  JobSummaryStatus,
  JobSummaryStatus[]
> = {
  in_progress: [
    'done',
    'cancelled',
  ],

  done: [],

  cancelled: [],
};