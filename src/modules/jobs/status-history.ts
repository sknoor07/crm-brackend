import {
  JobSummaryStatus,
} from '../../db/schema/index.js';

export const allowedJobTransitions: Record<
  JobSummaryStatus,
  JobSummaryStatus[]
> = {
  in_progress: [
    'pending_final_quote_onsite',
    'going_to_lab',
    'cancelled',
  ],

  going_to_lab:[],
  done: [],
  pending_final_quote_onsite: ['done'],
  cancelled: [],
};