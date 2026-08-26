# Appointment & Scheduling — Design

**Status:** Draft
**Parent PRD:** `new/docs/PRD.md` (§5.2, §8 Phase 1)

## Scope
The Appointment & Scheduling module manages patient appointment bookings, scheduling, and cancellations. This is a core workflow component that connects patients (registered or walk-in) with departments and doctors.

## Data Model

The `appointments` table will be created per-tenant (inside the `tenant_<hospitalId>` schema). 

| Table | Key fields | Notes |
|---|---|---|
| `appointments` | `id`, `patientId` (nullable), `firstName`, `lastName`, `contactNumber`, `appointmentDate`, `appointmentTime`, `doctorId` (nullable), `departmentId` (nullable), `appointmentType`, `status`, `reason`, `cancelledRemarks` | We use the Unified Model (Option 1): `patientId` is nullable to support walk-ins. `firstName`, `lastName`, and `contactNumber` are always recorded. `departmentId` and `doctorId` are opaque ID references to the Master Data and Accounts modules, enforcing bounded contexts (PRD G2). |

**Appointment Statuses:**
- `Scheduled`
- `Arrived`
- `Completed`
- `Cancelled`
- `NoShow`

## Permission Model

Two new permissions will be seeded in the `public.permissions` table:
- `appointment.manage`: Allows booking, rescheduling, and cancelling. Assigned to **Receptionist / Front Desk** and **Hospital Admin**.
- `appointment.read`: Allows viewing the schedule. Assigned to **Doctor**, **Nurse**, and other clinical staff so they can see their dockets.

## API Endpoints

- `POST /appointments` — Book an appointment. 
- `PUT /appointments/:id` — Update/reschedule an appointment.
- `PUT /appointments/:id/cancel` — Cancel an appointment (requires `cancelledRemarks`).
- `PUT /appointments/:id/arrive` — Mark a patient as arrived (this is typically when a walk-in is formally registered in the Patient module and the `patientId` is linked).
- `GET /appointments` — List appointments, filterable by `date`, `doctorId`, `departmentId`, and `status`.
- `GET /appointments/:id` — View details.

## Dependencies & Cross-Module Behavior

- **Cross-module validation:** When booking an appointment, the system does not enforce hard foreign keys to `patients`, `accounts` (doctors), or `departments`. Referential integrity is checked logically at the service boundary (e.g., fetching from `MasterDataService` to ensure a department exists).
- **Isolation:** Operations go through `TenantConnectionService` to ensure strict schema isolation.
- **Audit:** Appointment creation, modification, and cancellation will emit events to the `Audit` module.

## Error Handling

- Booking an appointment in the past → 400 Bad Request.
- Updating an already cancelled/completed appointment → 409 Conflict.
- Missing `cancelledRemarks` on cancellation → 400 Bad Request.
