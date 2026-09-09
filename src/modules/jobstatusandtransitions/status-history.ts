import {
  JobSummaryStatus,
} from '../../db/schema/index.js';

export const allowedJobTransitions: Record<
  JobSummaryStatus,
  JobSummaryStatus[]
> = {
  created: ['in_progress'],
  in_progress: [
    'assigning_pickup_Engineer',
    'cancelled',
  ],

  assigning_pickup_Engineer: [
    'repair_completed_onsite',
    'going_to_lab',
  ],

  repair_completed_onsite: [
    'pending_final_quote_onsite',
  ],

  going_to_lab: [
    'repair_in_progress_inlab',
  ],

  repair_in_progress_inlab: [
    'repair_completed_inlab',
  ],

  repair_completed_inlab: [
    'waitng_for_delivery',
  ],

  waitng_for_delivery: [
    'delivered',
  ],

  pending_final_quote_onsite: [
    'delivered',
    'cancelled',
  ],

  delivered: [
    'closed',
  ],

  done: [],

  closed: [],

  cancelled: [],
};

export const canTransitionJob = (
  currentStatus: JobSummaryStatus,
  nextStatus: JobSummaryStatus,
): boolean => {
  return (
    allowedJobTransitions[currentStatus]?.includes(
      nextStatus,
    ) ?? false
  );
};