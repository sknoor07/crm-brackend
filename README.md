# CRM Backend API

Repair-service workflow API built with Express, TypeScript, Drizzle ORM, and PostgreSQL.

## TestSprite testing

Use the machine-readable API contract at [testsprite/openapi.yaml](./testsprite/openapi.yaml) and the execution plan at [testsprite/api-test-plan.md](./testsprite/api-test-plan.md).

## Running the API

```bash
npm install
npm run dev
```

Initialize the database schema and required test data:

```bash
npm run db:setup
```

The seed creates one test user for each role. They all use the password `TestPassword123!` and have emails such as `admin@test.example.com` and `customer-service@test.example.com`.

Default base URL:

```text
http://localhost:5000
```

All versioned endpoints use:

```text
/api/v1
```

Protected endpoints require:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
```

## Roles

| Role | Main responsibility |
| --- | --- |
| `admin` | Full administrative access |
| `customer` | Create own requests and approve/reject own quotes |
| `customer_service` | Create/verify jobs, generate quotes, close jobs |
| `transport_manager` | Assign pickup/delivery technicians and receive devices at the lab |
| `repair_manager` | Assign lab technicians |
| `repair_person` | Perform field/lab technician actions |

## Standard error responses

Authentication and authorization errors:

```json
{
  "error": "Forbidden: Your role does not have permission to perform this action"
}
```

Validation errors:

```json
{
  "status": "error",
  "message": "Validation failed",
  "errors": [
    {
      "field": "jobId",
      "message": "Invalid job ID format"
    }
  ]
}
```

## Authentication APIs

### Register an employee

```http
POST /api/v1/auth/register
```

Creates an employee login and employee profile. The new employee is initially required to change their password.

Request:

```json
{
  "email": "john@example.com",
  "password": "SecurePassword123",
  "firstName": "John",
  "lastName": "Smith",
  "phone": "9876543210",
  "currentAddress": "Mumbai",
  "permanentAddress": "Pune"
}
```

Response `201`:

```json
{
  "message": "Employee created successfully",
  "user": {
    "id": "employee-uuid",
    "email": "john@example.com"
  }
}
```

### Login

```http
POST /api/v1/auth/login
```

Request:

```json
{
  "email": "john@example.com",
  "password": "SecurePassword123"
}
```

Response `200`:

```json
{
  "message": "Login successful",
  "accessToken": "jwt-access-token",
  "user": {
    "id": "user-uuid",
    "email": "john@example.com",
    "userType": "employee",
    "mustChangePassword": false
  }
}
```

The refresh token is sent as an HTTP-only cookie.

### Refresh an access token

```http
POST /api/v1/auth/refresh
```

No bearer access token is required. The client must send the HTTP-only `refreshToken` cookie created during login. The endpoint verifies the cookie against the signed refresh JWT and the active database session, then returns a new 15-minute access token.

Expired refresh-token database rows are cleaned up opportunistically when login or token refresh is requested. Active and unexpired sessions are not deleted.

Response `200`:

```json
{
  "accessToken": "new-jwt-access-token"
}
```

If the cookie is missing, expired, revoked, invalid, or belongs to an inactive user, the response is `401`.

### Accept a customer invitation

```http
POST /api/v1/auth/invitation/accept
```

Used by a customer created by CS to set a permanent password. Invitation tokens are one-time-use and expire after 24 hours.

Request:

```json
{
  "token": "64-character-invitation-token",
  "password": "CustomerPassword123"
}
```

Response `200`:

```json
{
  "message": "Account password set successfully. You can now log in.",
  "user": {
    "id": "customer-uuid",
    "email": "sarah@example.com"
  }
}
```

## Customer APIs

### List configured device categories

```http
GET /api/v1/jobs/device-categories
```

Roles: `customer`, `customer_service`, `admin`

Returns the device categories configured in `device_service_charges`. The customer and CS forms should use this response rather than accepting arbitrary category text.

Response `200`:

```json
{
  "categories": [
    {
      "value": "laptop",
      "serviceCharge": "1500.00"
    }
  ]
}
```

### Create a self-service repair request

```http
POST /api/v1/customer/jobs
```

Role: `customer`

Creates a job on behalf of the logged-in customer. The customer ID comes from the access token and cannot be supplied in the request.

Initial status:

```text
pending_cs_verification
```

Request:

```json
{
  "deviceCategory": "laptop",
  "issueDescription": "Laptop screen is not working"
}
```

Response `201`:

```json
{
  "message": "Repair request submitted successfully. It is awaiting CS verification.",
  "job": {
    "id": "job-uuid",
    "jobNumber": "JOB-UUID-DERIVED-NUMBER",
    "customerId": "customer-uuid",
    "deviceCategory": "laptop",
    "issueDescription": "Laptop screen is not working",
    "currentStatus": "pending_cs_verification"
  }
}
```

### Approve or reject a final quote

```http
PATCH /api/v1/customer/quote-response
```

Roles: `customer`, `customer_service`, `admin`

Customers can respond only to their own jobs.

Request:

```json
{
  "jobId": "job-uuid",
  "decision": "accept"
}
```

`decision` must be `accept` or `reject`.

Response `200`:

```json
{
  "message": "Quote accepted successfully.",
  "job": {
    "id": "job-uuid",
    "currentStatus": "repair_in_progress"
  }
}
```

Rejecting a quote changes the status to `repair_rejected`.

## Customer Service APIs

### Create a job for a customer

```http
POST /api/v1/jobs
```

Roles: `customer_service`, `admin`

Used when CS creates a job from a phone call or walk-in. If the customer does not exist, an account, profile, invitation, and job are created together in one transaction.

Required customer information includes phone and address.

Request:

```json
{
  "customerEmail": "sarah@example.com",
  "customerPhone": "9876543210",
  "customerFirstName": "Sarah",
  "customerLastName": "Smith",
  "billingAddress": "12 MG Road, Mumbai",
  "deviceCategory": "laptop",
  "issueDescription": "Laptop is not powering on",
  "estimatedComponentsCost": 1000
}
```

Initial status:

```text
ready_for_pickup
```

Response `201`:

```json
{
  "message": "Job created successfully by Customer Service",
  "job": {
    "id": "job-uuid",
    "jobNumber": "JOB-UUID-DERIVED-NUMBER",
    "customerId": "customer-uuid",
    "currentStatus": "ready_for_pickup"
  },
  "invitationToken": "present-only-for-a-new-customer"
}
```

The invitation token should be delivered through a secure email or SMS channel. Do not log it or expose it to unauthorized users.

### Verify a self-service job

```http
PATCH /api/v1/cs/approve-job
```

Roles: `customer_service`, `admin`

Moves a customer-created job from `pending_cs_verification` to `ready_for_pickup`.

Request:

```json
{
  "jobId": "job-uuid",
  "estimatedComponentsCost": 1000
}
```

Response `200`:

```json
{
  "message": "Job successfully verified and approved by CS. Moved to ready for pickup.",
  "job": {
    "id": "job-uuid",
    "currentStatus": "ready_for_pickup"
  }
}
```

### List jobs waiting for final quotes

```http
GET /api/v1/cs/pending-quotes
```

Roles: `customer_service`, `admin`

Response `200`:

```json
{
  "count": 1,
  "jobs": [
    {
      "id": "job-uuid",
      "currentStatus": "pending_final_quote",
      "requestedComponents": "LCD screen"
    }
  ]
}
```

### Generate a final quote

```http
PATCH /api/v1/cs/final-quote
```

Roles: `customer_service`, `admin`

The configured service charge for the device category is automatically added to the quote.

Request:

```json
{
  "jobId": "job-uuid",
  "finalComponentsCost": 5000
}
```

Response `200`:

```json
{
  "message": "Final quote generated successfully. Awaiting customer approval.",
  "job": {
    "id": "job-uuid",
    "finalComponentsCost": "5000",
    "serviceChargeApplied": "1500",
    "currentStatus": "awaiting_customer_approval"
  }
}
```

### Close a job

```http
PATCH /api/v1/cs/close
```

Roles: `customer_service`, `admin`

Closes a completed or rejected/cancelled job after CS verification.

Request:

```json
{
  "jobId": "job-uuid",
  "closingRemarks": "Repair verified with customer."
}
```

Response `200`:

```json
{
  "message": "Job successfully closed.",
  "job": {
    "id": "job-uuid",
    "currentStatus": "closed"
  }
}
```

## Transport Manager APIs

All transport endpoints require roles `transport_manager` or `admin`.

### List jobs ready for pickup

```http
GET /api/v1/transport/pending
```

Response:

```json
{
  "jobs": [
    {
      "id": "job-uuid",
      "currentStatus": "ready_for_pickup"
    }
  ]
}
```

### Assign a pickup technician

```http
PATCH /api/v1/transport/assign
```

The technician must be an active employee with the `repair_person` role.

Request:

```json
{
  "jobId": "job-uuid",
  "technicianId": "field-technician-uuid"
}
```

Response:

```json
{
  "message": "Technician assigned successfully. Job is pending pickup.",
  "job": {
    "id": "job-uuid",
    "assignedPickupTechId": "field-technician-uuid",
    "currentStatus": "pending_pickup"
  }
}
```

### Receive a device at the lab

```http
PATCH /api/v1/transport/receive-lab
```

Request:

```json
{
  "jobId": "job-uuid"
}
```

Response:

```json
{
  "message": "Device successfully received at the lab. Handover to repair team ready.",
  "job": {
    "id": "job-uuid",
    "currentStatus": "arrived_at_lab"
  }
}
```

### List completed lab jobs awaiting delivery

```http
GET /api/v1/transport/pending-deliveries
```

Only jobs with `repairLocation: "lab"` are returned.

Response:

```json
{
  "count": 1,
  "jobs": [
    {
      "id": "job-uuid",
      "repairLocation": "lab",
      "currentStatus": "repair_completed"
    }
  ]
}
```

### Assign a delivery technician

```http
PATCH /api/v1/transport/assign-delivery
```

The delivery technician may be different from the pickup or repair technician. The assignment is stored in `assignedDeliveryTechId`.

Request:

```json
{
  "jobId": "job-uuid",
  "technicianId": "delivery-technician-uuid"
}
```

Response:

```json
{
  "message": "Technician assigned for return delivery.",
  "job": {
    "id": "job-uuid",
    "assignedDeliveryTechId": "delivery-technician-uuid",
    "currentStatus": "out_for_delivery"
  }
}
```

## Field Technician APIs

All technician endpoints require authentication. The route permissions allow `admin` and the configured technician roles; the technician must also be assigned to the job.

### Send a device to the lab

```http
PATCH /api/v1/technician/transit
```

Used when the field technician cannot repair the device at the customer location.

Request:

```json
{
  "jobId": "job-uuid"
}
```

Response:

```json
{
  "message": "Job is now in transit to the lab.",
  "job": {
    "id": "job-uuid",
    "repairLocation": "lab",
    "currentStatus": "in_transit_to_lab"
  }
}
```

### Request an on-site repair quote

```http
PATCH /api/v1/technician/request-quote
```

Used when the field technician can repair the device at the customer site but needs parts.

Request:

```json
{
  "jobId": "job-uuid",
  "requestedComponents": "LCD screen",
  "additionalNotes": "Screen replacement required."
}
```

Response:

```json
{
  "message": "Final quote requested successfully. CS team has been notified.",
  "job": {
    "id": "job-uuid",
    "repairLocation": "customer_site",
    "currentStatus": "pending_final_quote"
  }
}
```

### Confirm return delivery

```http
PATCH /api/v1/technician/deliver
```

The assigned delivery technician confirms that the device reached the customer.

Request:

```json
{
  "jobId": "job-uuid",
  "deliveryNotes": "Delivered to Sarah after ID verification."
}
```

Response:

```json
{
  "message": "Device successfully delivered to the customer.",
  "job": {
    "id": "job-uuid",
    "currentStatus": "delivered"
  }
}
```

## Repair Manager and Repair Technician APIs

### List devices waiting for lab assignment

```http
GET /api/v1/repair/pending
```

Roles: `repair_manager`, `admin`

Response:

```json
{
  "count": 1,
  "jobs": [
    {
      "id": "job-uuid",
      "currentStatus": "arrived_at_lab"
    }
  ]
}
```

### Assign a lab technician

```http
PATCH /api/v1/repair/assign
```

Roles: `repair_manager`, `admin`

The target must be an active employee with the `repair_person` role.

Request:

```json
{
  "jobId": "job-uuid",
  "labTechId": "lab-technician-uuid"
}
```

Response:

```json
{
  "message": "Lab Technician assigned. Job is now in lab diagnosis.",
  "job": {
    "id": "job-uuid",
    "assignedRepairTechId": "lab-technician-uuid",
    "repairLocation": "lab",
    "currentStatus": "in_lab_diagnosis"
  }
}
```

### Request a lab repair quote

```http
PATCH /api/v1/repair/request-quote
```

Roles: `repair_person`, `admin`

Request:

```json
{
  "jobId": "job-uuid",
  "requestedComponents": "LCD screen and motherboard",
  "technicianNotes": "Motherboard damage found during diagnosis."
}
```

Response:

```json
{
  "message": "Lab diagnosis complete. CS team notified for final quoting.",
  "job": {
    "id": "job-uuid",
    "currentStatus": "pending_final_quote"
  }
}
```

### Mark repair completed

```http
PATCH /api/v1/repair/complete
```

Roles: `repair_person`, `admin`

The assigned field technician can complete an on-site repair. The assigned lab technician can complete a lab repair.

Request:

```json
{
  "jobId": "job-uuid",
  "repairNotes": "LCD replaced and device tested successfully."
}
```

Response:

```json
{
  "message": "Repair marked as completed successfully.",
  "job": {
    "id": "job-uuid",
    "currentStatus": "repair_completed"
  }
}
```

## Comments and audit notes

### Add a job comment

```http
POST /api/v1/comments
```

Roles: `admin`, `customer_service`, `transport_manager`, `repair_manager`, `repair_person`

Adds a timestamped note to the job audit trail.

Request:

```json
{
  "jobId": "job-uuid",
  "comment": "Customer was not home. Waited 10 minutes."
}
```

Response `201`:

```json
{
  "message": "Comment added successfully",
  "comment": {
    "id": "comment-uuid",
    "jobId": "job-uuid",
    "userId": "employee-uuid",
    "comment": "Customer was not home. Waited 10 minutes.",
    "createdAt": "2026-09-03T12:00:00.000Z"
  }
}
```

## Health check

```http
GET /api/health
```

Response:

```json
{
  "status": "OK",
  "message": "API is running smoothly!"
}
```

## Job status lifecycle

```text
Customer self-service:
pending_cs_verification
  -> ready_for_pickup

CS-created:
ready_for_pickup

Dispatch:
ready_for_pickup
  -> pending_pickup

On-site path:
pending_pickup
  -> pending_final_quote
  -> awaiting_customer_approval
  -> repair_in_progress
  -> repair_completed
  -> closed

Lab path:
pending_pickup
  -> in_transit_to_lab
  -> arrived_at_lab
  -> in_lab_diagnosis
  -> pending_final_quote
  -> awaiting_customer_approval
  -> repair_in_progress
  -> repair_completed
  -> out_for_delivery
  -> delivered
  -> closed
```

Status updates are validated and recorded in job status history inside database transactions.

## Database tables

The PostgreSQL database contains the following application tables. UUID values are used for primary and foreign keys; sensitive credentials and invitation values are stored as hashes.

### `users`

Stores the base login and account record for every employee and customer.

Key data:

- `id`: UUID primary key
- `email`: Unique login email
- `passwordHash`: Hashed password; the raw password is never stored
- `userType`: `employee` or `customer`
- `phone`: Account phone number
- `isActive`: Whether login and account use are enabled
- `mustChangePassword`: Whether the user must set a new password
- `createdAt`, `updatedAt`: Account timestamps

### `employee_profiles`

Stores employee identity, compliance, payroll, emergency-contact, address, and specialization data. It is linked one-to-one with `users` through `userId`.

Key data:

- Name and phone
- Date of birth
- Aadhaar, PAN, and UAN details
- Current and permanent addresses
- Bank account, IFSC, and bank name
- Emergency contact
- `specializations`: JSON list of work specializations

### `customer_profiles`

Stores customer CRM information separately from login credentials.

Key data:

- `userId`: Linked customer account
- First and last name
- Phone number
- Billing/service address

### `roles`

Stores the system roles available for authorization.

Key data:

- `id`: UUID primary key
- `name`: Unique role name such as `customer_service`, `repair_person`, or `transport_manager`
- `description`: Role description
- `permissions`: Optional JSON permission data

### `user_roles`

Junction table assigning one or more roles to a user.

Key data:

- `userId`: User receiving the role
- `roleId`: Assigned role
- `assignedBy`: Employee who assigned the role
- `createdAt`: Assignment timestamp

### `teams`

Stores organizational teams such as Repair or Transport and their manager.

Key data:

- `id`: UUID primary key
- `name`: Unique team name
- `managerId`: User responsible for the team
- `createdAt`: Team creation timestamp

### `refresh_tokens`

Stores active login sessions securely.

Key data:

- `userId`: Token owner
- `tokenHash`: Hash of the refresh token; raw token is kept only in the HTTP-only cookie
- `expiresAt`: Session expiration
- `isRevoked`: Whether the session has been invalidated
- `createdAt`: Token creation timestamp

### `account_invitations`

Stores one-time invitations for customer accounts created by CS.

Key data:

- `userId`: Customer receiving the invitation
- `tokenHash`: Hash of the invitation token
- `expiresAt`: Invitation expiration, currently 24 hours
- `usedAt`: Set when the customer accepts the invitation
- `createdAt`: Invitation creation timestamp

The raw invitation token is not stored in the database.

### `device_service_charges`

Stores the hidden service charge configured for each device category.

Key data:

- `deviceCategory`: Unique category such as `laptop`
- `chargeAmount`: Service charge automatically added to final quotes
- `createdAt`: Configuration creation timestamp

### `jobs`

Stores the main repair-service order and its current workflow state.

Key data:

- `id`: Internal UUID primary key
- `jobNumber`: Unique human-readable job identifier
- `customerId`: Customer who owns the repair
- `deviceCategory`: Device type
- `issueDescription`: Customer-reported problem
- `currentStatus`: Controlled workflow status
- `repairLocation`: `customer_site` or `lab`
- Component estimates and final quote amounts
- Applied service charge
- Final quote approval flag
- Transport, repair, pickup, and delivery assignments
- Requested components and technician notes
- `createdAt`, `updatedAt`: Job timestamps

### `job_comments`

Stores timestamped notes added by internal employees during the job lifecycle.

Key data:

- `jobId`: Related repair job
- `userId`: Employee who wrote the note
- `comment`: Note text
- `createdAt`: Comment timestamp

Examples include pickup issues, customer communication, repair notes, and delivery notes.

### `job_status_history`

Stores the complete audit trail of job status changes.

Key data:

- `jobId`: Related repair job
- `previousStatus`: Status before the change
- `newStatus`: Status after the change
- `changedBy`: User who caused the transition
- `note`: Optional transition explanation
- `createdAt`: Transition timestamp

Status updates and their corresponding history records are written in the same database transaction.

## Database relationships

```text
users
  ├── employee_profiles
  ├── customer_profiles
  ├── user_roles ── roles
  ├── refresh_tokens
  ├── account_invitations
  └── jobs
        ├── job_comments
        └── job_status_history

jobs.deviceCategory ── device_service_charges.deviceCategory
teams.managerId ── users.id
```
