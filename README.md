# CRM Backend API

REST API for the CRM repair workflow.

## Base URL

```text
http://localhost:5000
```

API routes are prefixed with `/api/v1`, except the health check.

## Run locally

```bash
npm install
npm run db:setup
npm run dev
```

The port is controlled by `PORT` and defaults to `5000`.

## Authentication

Protected routes require an access token:

```http
Authorization: Bearer <accessToken>
```

`POST /api/v1/auth/login` also sets an HTTP-only `refreshToken` cookie. Send cookies when calling `POST /api/v1/auth/refresh`.

## Common errors

### Authentication

```json
{ "error": "Authentication token missing or malformed" }
```

```json
{ "error": "Invalid or expired access token" }
```

### Authorization

```json
{ "error": "Forbidden: No roles assigned" }
```

```json
{ "error": "Forbidden: Your role does not have permission to perform this action" }
```

### Validation

Validation errors return `400`:

```json
{
  "status": "error",
  "message": "Validation failed",
  "errors": [
    { "field": "jobItemId", "message": "Invalid job item ID format" }
  ]
}
```

Validation middleware can validate JSON bodies, path parameters, or query strings and writes the parsed Zod result back to the request. Existing query-based endpoints are not currently registered. For example, `GET /api/v1/technician/:jobId/items` validates `jobId` as a UUID and returns the standard validation error for malformed values.

Unless an endpoint documents a more specific response, database or unexpected failures return `500`:

```json
{ "error": "Internal server error" }
```

## Response row shapes

Several endpoints return complete database rows. The following abbreviated examples show the shape; the actual response can contain every column on the returned row.

### Job row

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "jobNumber": "JOB-20260905-0001",
  "customerId": "550e8400-e29b-41d4-a716-446655440001",
  "currentStatus": "in_progress",
  "transportManagerId": null,
  "assignedTransportTeamPersonId": null,
  "repairManagerId": null,
  "assignedDeliveryTechId": null,
  "createdAt": "2026-09-05T10:00:00.000Z",
  "updatedAt": "2026-09-05T10:00:00.000Z"
}
```

### Job item row

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "deviceCategory": "Laptop",
  "deviceSerialNumber": "SN12345",
  "issueDescription": "Laptop does not power on",
  "issueCategory": null,
  "repairLocation": "lab",
  "currentStatus": "pending_cs_verification",
  "assignedRepairPersonId": null,
  "estimatedComponentsCost": "2500.00",
  "finalComponentsCost": null,
  "serviceChargeApplied": "500.00",
  "isFinalQuoteApproved": false,
  "requestedComponents": null,
  "diagnosisNotes": null,
  "repairNotes": null,
  "baseRepairCost": null,
  "isWarrantyClaim": false,
  "originalJobItemId": null,
  "createdAt": "2026-09-05T10:00:00.000Z",
  "updatedAt": "2026-09-05T10:00:00.000Z"
}
```

`<full jobs row>`, `<full job_items row>`, and similar text below mean the corresponding complete row described above, not a literal string returned by the server.

# Endpoint reference

There are 47 live endpoints: 46 mounted module endpoints and `GET /api/health`. The warranties router exists but is empty and currently exposes no warranty endpoint.

## Health

### `GET /api/health`

Authentication: none.

Response `200`:

```json
{ "status": "OK", "message": "API is running smoothly!" }
```

## Authentication

### `POST /api/v1/auth/register`

Authentication: Bearer token. Role: `admin`.

Request body:

```json
{
  "email": "employee@example.com",
  "firstName": "Anita",
  "lastName": "Sharma",
  "phone": "+919876543210",
  "dateOfBirth": "1992-04-15",
  "aadhaarNumber": "123456789012",
  "panNumber": "ABCDE1234F",
  "uanNumber": "123456789012",
  "currentAddress": "Bengaluru",
  "permanentAddress": "Mysuru",
  "bankAccountNumber": "1234567890",
  "bankIfscCode": "SBIN0001234",
  "bankName": "State Bank",
  "emergencyContactName": "Ravi Sharma",
  "emergencyContactPhone": "+919876543211",
  "specializations": ["Laptop repair"],
  "roleIds": ["550e8400-e29b-41d4-a716-446655440003"]
}
```

Required: `email`, `firstName`, `lastName`, `roleIds`. `roleIds` must contain at least one UUID. Aadhaar/UAN are 12 digits, PAN follows `AAAAA9999A`, and IFSC follows `AAAA0999999`. Other employee fields are optional strings; `dateOfBirth` must be date-parseable.

Response `201`:

```json
{
  "message": "Employee registered successfully",
  "employee": {
    "id": "550e8400-e29b-41d4-a716-446655440004",
    "email": "employee@example.com"
  },
  "invitationToken": "64-character-hex-token"
}
```

The invitation token is only returned in non-production environments. Duplicate email and invalid role IDs return `400`.

### `POST /api/v1/auth/login`

Authentication: none.

Request body:

```json
{ "email": "employee@example.com", "password": "secret123" }
```

Response `200`:

```json
{
  "message": "Login successful",
  "accessToken": "jwt-access-token",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440004",
    "email": "employee@example.com",
    "userType": "employee",
    "roles": ["admin"],
    "mustChangePassword": true
  }
}
```

Also sets the HTTP-only `refreshToken` cookie. Invalid credentials, inactive users, and users without a password return `401`.

### `POST /api/v1/auth/refresh`

Authentication: refresh-token cookie. No body.

Response `200`:

```json
{ "accessToken": "jwt-access-token" }
```

Possible `401` responses:

```json
{ "error": "Refresh token missing" }
```

```json
{ "error": "Refresh token is invalid, expired, or revoked" }
```

```json
{ "error": "User account is inactive or unavailable" }
```

### `POST /api/v1/auth/invitation/accept`

Authentication: none.

Request body:

```json
{ "token": "64-character-hex-token", "password": "newpassword123" }
```

`token` must be exactly 64 characters and `password` must be at least 8 characters.

Response `200`:

```json
{
  "message": "Account password set successfully. You can now log in.",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440004",
    "email": "employee@example.com"
  }
}
```

Invalid, expired, or already-used invitations return `400`.

### `GET /api/v1/auth/me`

Authentication: Bearer token.

Response `200`:

```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440004",
    "email": "employee@example.com",
    "userType": "employee",
    "mustChangePassword": false,
    "roles": ["admin"]
  }
}
```

## Roles

### `GET /api/v1/roles/`

Authentication: Bearer token. Role: `admin`.

Response `200`:

```json
{
  "roles": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440003",
      "name": "admin",
      "description": "System administrator"
    }
  ]
}
```

## Jobs

### `GET /api/v1/jobs/device-categories`

Authentication: Bearer token. Roles: `admin`, `customer_service`, `customer`.

Response `200`:

```json
{
  "categories": [
    { "value": "Laptop", "serviceCharge": "500.00" }
  ]
}
```

### `POST /api/v1/jobs/`

Authentication: Bearer token. Roles: `admin`, `customer_service`.

Request body:

```json
{
  "customerEmail": "customer@example.com",
  "customerPhone": "+919876543210",
  "customerFirstName": "Ravi",
  "customerLastName": "Kumar",
  "billingAddress": "Bengaluru",
  "deviceCategory": "Laptop",
  "deviceSerialNumber": "SN12345",
  "issueDescription": "Laptop does not power on",
  "estimatedComponentsCost": 2500,
  "comment": "Customer reports sudden shutdown"
}
```

Required strings: `customerEmail`, `customerPhone`, `customerFirstName`, `customerLastName`, `billingAddress`, `deviceCategory`, `issueDescription`, `comment`. `deviceSerialNumber` is optional. `issueDescription` must have at least 5 characters, `comment` must be 1-2000 characters, and `estimatedComponentsCost` must be a nonnegative number.

Response `201`:

```json
{
  "message": "Job created successfully by Customer Service",
  "job": "<full jobs row>",
  "item": "<full job_items row>",
  "invitationToken": "hex-token-when-new-customer"
}
```

`invitationToken` is omitted when the customer already exists. Invalid device categories return `400`.

## Customer

### `POST /api/v1/customer/jobs`

Authentication: Bearer token. Role: `customer`.

Request body:

```json
{
  "deviceCategory": "Laptop",
  "issueDescription": "Screen is flickering",
  "comment": "Please call before visiting"
}
```

Required: `deviceCategory`, `issueDescription`. Optional: `comment`. The issue description must have at least 5 characters and the comment may be up to 2000 characters.

Response `201`:

```json
{
  "message": "Repair request submitted successfully. It is awaiting CS verification.",
  "job": "<full jobs row>",
  "jobItem": "<full job_items row>"
}
```

### `PATCH /api/v1/customer/quote-response`

Authentication: Bearer token. Roles: `admin`, `customer_service`, `customer`.

Request body:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "decision": "accept",
  "comment": "Approved"
}
```

`jobItemId` and `decision` are required. `decision` is `accept` or `reject`; `comment` is optional and limited to 2000 characters.

Response `200`:

```json
{
  "message": "Quote accepted successfully.",
  "jobItem": "<full job_items row>"
}
```

For `decision: "reject"`, the message is `Quote rejected successfully.`. Ownership violations return `403`; missing records return `404`; invalid workflow status returns `400`.

## Customer Service

All endpoints in this section require a Bearer token and one of these roles: `admin`, `customer_service`.

### `PATCH /api/v1/cs/approve-item`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "estimatedComponentsCost": 2500,
  "comment": "Verified repair request"
}
```

`jobItemId` and `comment` are required. `estimatedComponentsCost` is optional and nonnegative.

Response `200`:

```json
{
  "message": "Job item verified successfully and approved for transport.",
  "jobItem": "<full job_items row>"
}
```

### `PATCH /api/v1/cs/reject-item`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Repair request cannot be accepted"
}
```

Response `200`:

```json
{
  "message": "Job item rejected successfully.",
  "jobItem": "<full job_items row>"
}
```

### `PATCH /api/v1/cs/final-quote`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "finalComponentsCost": 3500,
  "comment": "Final quote prepared"
}
```

All fields are required; `finalComponentsCost` must be nonnegative.

Response `200`:

```json
{
  "message": "Final quote generated successfully. Awaiting customer approval.",
  "jobItem": "<full job_items row>",
  "quote": {
    "version": 1,
    "componentsCost": 3500,
    "serviceCharge": 500,
    "totalAmount": 4000
  }
}
```

### `GET /api/v1/cs/pending-quotes`

Response `200`:

```json
{
  "count": 1,
  "jobs": [
    { "job": "<full jobs row>", "jobItem": "<full job_items row>" }
  ]
}
```

### `GET /api/v1/cs/pending-approval`

Response `200`:

```json
{
  "count": 1,
  "jobs": [
    { "job": "<full jobs row>", "jobItem": "<full job_items row>" }
  ]
}
```

### `GET /api/v1/cs/pending-onsite-confirmation`

Response `200`:

```json
{
  "count": 1,
  "items": [
    { "job": "<full jobs row>", "jobItem": "<full job_items row>" }
  ]
}
```

### `PATCH /api/v1/cs/confirm-onsite-repair`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "customerConfirmed": true,
  "comment": "Customer confirmed completion"
}
```

`customerConfirmed` must literally be `true`.

Response `200`:

```json
{
  "message": "Onsite repair has been confirmed with the customer.",
  "item": "<full job_items row>"
}
```

### `GET /api/v1/cs/ready-for-closure`

Response `200`:

```json
{
  "count": 1,
  "jobs": [
    { "job": "<full jobs row>", "items": ["<full job_items rows>"] }
  ]
}
```

### `PATCH /api/v1/cs/close`

Request:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "customerConfirmed": true,
  "paymentConfirmed": true,
  "closingRemarks": "All items delivered and payment received"
}
```

All fields are required. Both confirmation fields must literally be `true`; remarks are limited to 2000 characters.

Response `200`:

```json
{
  "message": "Job successfully closed.",
  "job": "<full jobs row>"
}
```

## Transport manager

All endpoints in this section require a Bearer token and one of these roles: `admin`, `transport_manager`.

### `GET /api/v1/transport/pending`

Response `200`:

```json
{ "count": 1, "jobs": ["<full jobs row>"] }
```

### `PATCH /api/v1/transport/assign`

Request:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "transportPersonId": "550e8400-e29b-41d4-a716-446655440005",
  "comment": "Assigned for pickup"
}
```

All fields are required; both IDs must be UUIDs and `comment` must be 1-2000 characters.

Response `200`:

```json
{
  "message": "Job successfully assigned to the transport team person.",
  "job": "<full jobs row>"
}
```

### `PATCH /api/v1/transport/receive-lab`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Item received at lab"
}
```

Response `200`:

```json
{
  "message": "Item successfully received at the lab.",
  "item": "<full job_items row>"
}
```

### `GET /api/v1/transport/pending-deliveries`

Response `200`:

```json
{ "count": 1, "jobs": ["<full jobs row>"] }
```

### `PATCH /api/v1/transport/assign-delivery`

Request:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "deliveryPersonId": "550e8400-e29b-41d4-a716-446655440006",
  "comment": "Assigned for delivery"
}
```

Response `200`:

```json
{
  "message": "Delivery person assigned successfully. Job is now out for delivery.",
  "job": "<full jobs row>"
}
```

## Technician / transport person

Most endpoints require roles `admin`, `transport_team_person`. Delivery endpoints also allow `repair_person`.

### `GET /api/v1/technician/assigned-jobs`

Response `200`:

```json
{ "jobs": ["<full jobs row>"] }
```

### `PATCH /api/v1/technician/start`

Request:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "comment": "Starting customer visit"
}
```

Response `200`:

```json
{ "message": "Customer visit has been started.", "job": "<full jobs row>" }
```

### `GET /api/v1/technician/:jobId/items`

Path parameter: `jobId`. No UUID validator is attached to this route.

Example: `GET /api/v1/technician/550e8400-e29b-41d4-a716-446655440000/items`

Response `200`:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "items": ["<full job_items rows>"]
}
```

### `PATCH /api/v1/technician/inspect-item`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Inspecting item at customer site"
}
```

Response `200`:

```json
{ "message": "Item inspection has started.", "item": "<full job_items row>" }
```

### `PATCH /api/v1/technician/send-item-to-lab`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Sending item to lab"
}
```

Response `200`:

```json
{ "message": "Item has been sent to the lab.", "item": "<full job_items row>" }
```

### `PATCH /api/v1/technician/request-final-quote`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "requestedComponents": "Replace motherboard",
  "additionalNotes": "Customer-site repair",
  "comment": "Quote required"
}
```

Required: `jobItemId`, `comment`. Optional: `requestedComponents`, `additionalNotes`, each up to 2000 characters.

Response `200`:

```json
{
  "message": "Final quote requested. CS team will prepare the customer quote.",
  "item": "<full job_items row>"
}
```

### `PATCH /api/v1/technician/reject-item`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Item cannot be repaired"
}
```

Response `200`:

```json
{ "message": "Item has been rejected.", "item": "<full job_items row>" }
```

### `PATCH /api/v1/technician/start-repair`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Starting onsite repair"
}
```

Response `200`:

```json
{ "message": "Onsite repair has started.", "item": "<full job_items row>" }
```

### `PATCH /api/v1/technician/complete-repair`

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Onsite repair completed"
}
```

Response `200`:

```json
{
  "message": "Onsite repair completed. CS team has been notified for customer confirmation.",
  "item": "<full job_items row>"
}
```

### `GET /api/v1/technician/delivery-jobs`

Roles: `admin`, `transport_team_person`, `repair_person`.

Response `200`:

```json
{ "jobs": ["<full jobs row>"] }
```

### `PATCH /api/v1/technician/start-delivery`

Roles: `admin`, `transport_team_person`, `repair_person`.

Request:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "comment": "Starting delivery"
}
```

Response `200`:

```json
{ "message": "Delivery has started.", "job": "<full jobs row>" }
```

### `PATCH /api/v1/technician/deliver-item`

Roles: `admin`, `transport_team_person`, `repair_person`.

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Item delivered to customer"
}
```

Response `200`:

```json
{ "message": "Item has been marked as delivered.", "item": "<full job_items row>" }
```

## Repair

### `GET /api/v1/repair/pending-assignment`

Authentication: Bearer token. Roles: `admin`, `repair_manager`.

Response `200`:

```json
{
  "count": 1,
  "items": [
    { "item": "<full job_items row>", "job": "<full jobs row>" }
  ]
}
```

### `PATCH /api/v1/repair/assign`

Authentication: Bearer token. Roles: `admin`, `repair_manager`.

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "repairPersonId": "550e8400-e29b-41d4-a716-446655440007",
  "comment": "Assigned for diagnosis"
}
```

Response `200`:

```json
{ "message": "Repair item assigned successfully.", "item": "<full job_items row>" }
```

### `GET /api/v1/repair/pending-inspection`

Authentication: Bearer token. Roles: `admin`, `repair_manager`.

Response `200`:

```json
{
  "count": 1,
  "items": [
    { "item": "<full job_items row>", "job": "<full jobs row>" }
  ]
}
```

### `PATCH /api/v1/repair/approve`

Authentication: Bearer token. Roles: `admin`, `repair_manager`.

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Repair approved after inspection"
}
```

Response `200`:

```json
{ "message": "Repair approved by Repair Team Manager.", "item": "<full job_items row>" }
```

### `PATCH /api/v1/repair/reject-inspection`

Authentication: Bearer token. Roles: `admin`, `repair_manager`.

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Repair requires more work"
}
```

Response `200`:

```json
{
  "message": "Repair rejected during inspection. Item returned to Repair Person.",
  "item": "<full job_items row>"
}
```

### `GET /api/v1/repair/my-items`

Authentication: Bearer token. Roles: `admin`, `repair_person`.

Response `200`:

```json
{
  "count": 1,
  "items": [
    { "item": "<full job_items row>", "job": "<full jobs row>" }
  ]
}
```

### `PATCH /api/v1/repair/start-diagnosis`

Authentication: Bearer token. Roles: `admin`, `repair_person`.

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Diagnosis started"
}
```

Response `200`:

```json
{ "message": "Diagnosis started successfully.", "item": "<full job_items row>" }
```

### `PATCH /api/v1/repair/request-final-quote`

Authentication: Bearer token. Roles: `admin`, `repair_person`.

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "requestedComponents": "Cooling fan",
  "diagnosisNotes": "Fan bearing is damaged",
  "comment": "Diagnosis completed"
}
```

Required: `jobItemId`, `comment`. Optional: `requestedComponents`, `diagnosisNotes`, each up to 2000 characters.

Response `200`:

```json
{
  "message": "Diagnosis completed. Item sent to Customer Service for final quotation.",
  "item": "<full job_items row>"
}
```

### `PATCH /api/v1/repair/start-repair`

Authentication: Bearer token. Roles: `admin`, `repair_person`.

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Starting authorized repair"
}
```

Response `200`:

```json
{ "message": "Repair started successfully.", "item": "<full job_items row>" }
```

### `PATCH /api/v1/repair/complete-repair`

Authentication: Bearer token. Roles: `admin`, `repair_person`.

Request:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "repairNotes": "Replaced the cooling fan",
  "comment": "Repair completed"
}
```

`repairNotes` is optional and limited to 2000 characters.

Response `200`:

```json
{
  "message": "Repair completed and sent for Repair Manager inspection.",
  "item": "<full job_items row>"
}
```

## Comments

### `POST /api/v1/comments/`

Authentication: Bearer token. Roles: `admin`, `customer_service`, `transport_manager`, `transport_team_person`, `repair_manager`, `repair_person`.

Exactly one of `jobId` or `jobItemId` is required. `comment` is required and limited to 2000 characters.

Request for a job comment:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "comment": "Customer contacted successfully"
}
```

Request for an item comment:

```json
{
  "jobItemId": "550e8400-e29b-41d4-a716-446655440002",
  "comment": "Item inspection completed"
}
```

Response `201`:

```json
{
  "message": "Comment added successfully",
  "comment": {
    "id": "550e8400-e29b-41d4-a716-446655440008",
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "jobItemId": null,
    "userId": "550e8400-e29b-41d4-a716-446655440004",
    "comment": "Customer contacted successfully",
    "createdAt": "2026-09-05T10:30:00.000Z"
  }
}
```

A missing target returns `404`; providing both `jobId` and `jobItemId` returns validation `400`.

## Workflow notes

- UUID examples use the standard UUID format; replace them with IDs from your database.
- Monetary request fields are JSON numbers. Monetary values in database rows may be returned as decimal strings.
- Workflow endpoints enforce current item/job status and assignment ownership in their controllers. A valid request body can still return `400` or `403` when the workflow state or user assignment is wrong.
- No warranty endpoints are currently registered even though warranty schema/controller files exist.
