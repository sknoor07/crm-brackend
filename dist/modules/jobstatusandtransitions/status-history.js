export const allowedJobTransitions = {
    created: [
        'in_progress',
    ],
    in_progress: [
        'assigning_pickup_Engineer',
        'cancelled',
    ],
    assigning_pickup_Engineer: [
        'pending_visit',
    ],
    pending_visit: [
        'pending_final_quote', //onsite
        'going_to_lab',
    ],
    pending_final_quote: [
        'repair_in_progress', //inlab
        'cancelled',
        'repair_started'
    ],
    repair_started: [
        'repair_completed',
    ],
    repair_completed: [
        'closed',
        'waitng_for_delivery', //lab   
    ],
    going_to_lab: [
        'repair_in_progress', //lab
    ],
    repair_in_progress: [
        'repair_in_progress',
        'pending_final_quote', //lab
        'repair_completed', //lab
    ],
    waitng_for_delivery: [
        'delivered', //lab
    ],
    delivered: [
        'closed',
    ],
    done: [],
    closed: [],
    cancelled: [],
};
export const canTransitionJob = (currentStatus, nextStatus) => {
    return (allowedJobTransitions[currentStatus]?.includes(nextStatus) ?? false);
};
