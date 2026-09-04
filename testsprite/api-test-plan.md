# TestSprite API Test Plan

## Test target

- Base URL: `http://localhost:5000`
- OpenAPI contract: `testsprite/openapi.yaml`
- Health check: `GET /api/health`
- Start locally: `npm run dev`

The API requires a reachable PostgreSQL database, configured device-service-charge rows, configured roles, and users with role assignments.

## Required test fixtures

Create or identify:

- One customer account with the `customer` role
- One CS user with `customer_service`
- One transport manager with `transport_manager`
- One repair manager with `repair_manager`
- One active field technician with `repair_person`
- One active lab technician with `repair_person`
- One second active technician for return delivery
- A `laptop` row in `device_service_charges`

Keep fixture IDs and access tokens as TestSprite variables:

```text
baseUrl
customerToken
csToken
transportManagerToken
repairManagerToken
fieldTechToken
labTechToken
pickupTechId
labTechId
deliveryTechId
category
```

## Authentication and authorization tests

| ID | Test | Expected |
| --- | --- | --- |
| AUTH-01 | Call a protected endpoint without `Authorization` | `401` |
| AUTH-02 | Call a protected endpoint with an invalid token | `401` |
| AUTH-03 | Customer calls CS job creation | `403` |
| AUTH-04 | CS calls transport assignment | `403` |
| AUTH-05 | Transport manager calls lab assignment | `403` |
| AUTH-06 | Customer submits a quote response for another customer’s job | `403` |

## Validation and reference-data tests

| ID | Test | Expected |
| --- | --- | --- |
| VAL-01 | List device categories as customer | `200`; categories come from `device_service_charges` |
| VAL-02 | Submit a job with an unknown category such as `vivobook` | `400`; no job is created |
| VAL-03 | CS creates a job without phone | `400`; no account/profile/job is created |
| VAL-04 | CS creates a job without address | `400`; no account/profile/job is created |
| VAL-05 | Send malformed UUID or missing required fields | `400` validation response |
| VAL-06 | Accept an invitation with an expired or reused token | `400` |

## Scenario 1: customer self-service

1. Customer creates a job using `POST /api/v1/customer/jobs`.
2. Assert response `201`.
3. Assert `currentStatus = pending_cs_verification`.
4. Assert `customerId` equals the authenticated customer.
5. CS approves with `PATCH /api/v1/cs/approve-job`.
6. Assert `currentStatus = ready_for_pickup`.
7. Assert a status-history record exists for both transitions.

## Scenario 2: CS-created job

1. CS submits customer details and a valid configured category to `POST /api/v1/jobs`.
2. Assert response `201` and `currentStatus = ready_for_pickup`.
3. Assert the job, customer account, customer profile, invitation, and initial history record exist.
4. Accept the invitation through `POST /api/v1/auth/invitation/accept`.
5. Assert the invitation cannot be accepted a second time.
6. Repeat with an existing customer and assert profile details are updated and no duplicate customer is created.

## Path A: on-site repair

1. Transport manager assigns pickup technician: `PATCH /api/v1/transport/assign`.
2. Assert `pending_pickup` and `assignedPickupTechId`.
3. Field technician requests parts: `PATCH /api/v1/technician/request-quote`.
4. Assert `pending_final_quote` and `repairLocation = customer_site`.
5. CS generates final quote: `PATCH /api/v1/cs/final-quote`.
6. Assert `awaiting_customer_approval` and service charge is applied.
7. Customer accepts quote: `PATCH /api/v1/customer/quote-response`.
8. Assert `repair_in_progress`.
9. Assigned field technician completes repair: `PATCH /api/v1/repair/complete`.
10. Assert `repair_completed`.
11. Assert the job is absent from `GET /api/v1/transport/pending-deliveries`.
12. CS closes after verification: `PATCH /api/v1/cs/close`.
13. Assert `closed`.

## Path B: lab repair

1. Assign pickup technician and move job to `pending_pickup`.
2. Field technician calls `PATCH /api/v1/technician/transit`.
3. Assert `in_transit_to_lab` and `repairLocation = lab`.
4. Transport manager receives device with `PATCH /api/v1/transport/receive-lab`.
5. Assert `arrived_at_lab`.
6. Repair manager assigns lab technician with `PATCH /api/v1/repair/assign`.
7. Assert `in_lab_diagnosis` and `assignedRepairTechId`.
8. Lab technician requests quote with `PATCH /api/v1/repair/request-quote`.
9. Complete CS quote generation and customer approval.
10. Lab technician completes repair.
11. Assert `repair_completed` and the job appears in pending deliveries.
12. Assign a different delivery technician with `PATCH /api/v1/transport/assign-delivery`.
13. Assert `assignedDeliveryTechId` is set and the pickup/repair assignments remain unchanged.
14. Delivery technician confirms with `PATCH /api/v1/technician/deliver`.
15. Assert `delivered`, then CS closes the job and assert `closed`.

## Transition and transaction tests

| ID | Test | Expected |
| --- | --- | --- |
| FLOW-01 | Attempt an invalid status jump, such as `pending_pickup` to `closed` | Request fails; status and history remain unchanged |
| FLOW-02 | Repeat any successful transition with the same job | Request fails; no duplicate history row |
| FLOW-03 | Force a history-write failure in a disposable environment | Job update rolls back with no partial status change |
| FLOW-04 | Inspect each completed flow’s history | Every status change has previous status, new status, actor, and timestamp |

## Audit and data-integrity tests

| ID | Test | Expected |
| --- | --- | --- |
| AUDIT-01 | Add an internal comment | `201`; comment includes actor and timestamp |
| AUDIT-02 | Add a blank comment | `400` |
| AUDIT-03 | Assign a customer ID as a technician | `400`; assignment is not changed |
| AUDIT-04 | Assign an inactive or non-`repair_person` employee | `400`; assignment is not changed |
| AUDIT-05 | Assign a separate delivery technician | Pickup and repair technician IDs are preserved |

## Expected TestSprite deliverables

- Pass/fail result for each case
- Request and response evidence
- Status before and after each workflow step
- Created job IDs and history IDs
- Database cleanup or disposable test-environment notes
- Defect report containing endpoint, role, payload, actual response, and expected response
