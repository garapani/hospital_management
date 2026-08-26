# Clinical Vitals & Triage - Design Specification

## Overview
This module introduces the Clinical Vitals & Triage subsystem for the new Hospital Management System. It replaces the legacy `VitalsModel.cs` by focusing strictly on physiological measurements and nursing triage observations, extracting out non-physiological fields like "Advice" and "Diagnosis" into their own future modules.

## Architecture & Data Flow
The module will be a new NestJS module (`VitalsModule`) residing within the `apps/api/src/clinical/vitals` directory. It will follow the established modular monolith pattern.

Data will flow from the Controller -> Service -> TypeORM Repository, ensuring that all operations are safely scoped to the active tenant via `TenantConnectionService`.

## Data Model
The `Vital` entity will capture the following fields:

- `id`: UUID (Primary Key)
- `patientId`: UUID (Foreign Key to `Patient`, Required)
- `appointmentId`: UUID (Foreign Key to `Appointment`, Optional. Allows IPD vitals or walk-ins without appointments).
- `height`: Decimal (cm)
- `weight`: Decimal (kg)
- `bmi`: Decimal (auto-calculated from height and weight)
- `temperature`: Decimal (Celsius)
- `pulse`: Integer (bpm)
- `bpSystolic`: Integer (mmHg)
- `bpDiastolic`: Integer (mmHg)
- `respiratoryRate`: Integer (breaths per min)
- `spO2`: Decimal (%)
- `painScale`: Integer (0-10 scale)
- `triageNotes`: String (Brief observations by the nurse during triage)
- `recordedAt`: Timestamp (Defaults to current time, can be backdated)

## RBAC & Security

**Permissions:**
- `vitals.manage`: Allows creating, updating, and voiding vitals.
- `vitals.read`: Allows viewing patient vitals.

**Role Mappings:**
- **Nurse**: `vitals.manage`, `vitals.read`
- **Doctor**: `vitals.manage`, `vitals.read`
- **Hospital Admin**: `vitals.manage`, `vitals.read`
- **Super Admin**: `vitals.manage`, `vitals.read`
- **Receptionist / Front Desk**: `vitals.read` (View-only for basic tracking, cannot manage)

## API Endpoints

- `POST /api/vitals` 
  - Body: Vitals payload (`patientId` required). 
  - Requires: `vitals.manage`
- `GET /api/patients/:patientId/vitals` 
  - Returns: List of vitals sorted by `recordedAt` DESC. 
  - Requires: `vitals.read`
- `GET /api/appointments/:appointmentId/vitals` 
  - Returns: List of vitals recorded for a specific appointment. 
  - Requires: `vitals.read`
- `PUT /api/vitals/:id` 
  - Body: Updates to vitals (for correction). 
  - Requires: `vitals.manage`
- `DELETE /api/vitals/:id` 
  - Action: Soft delete/voids the vitals record. 
  - Requires: `vitals.manage`

## Error Handling
- Validation errors on body payload (e.g. invalid ranges like negative weight, spO2 > 100) will throw `400 Bad Request`.
- Foreign key constraints (invalid patient or appointment ID) will throw `404 Not Found`.
- Tenant context errors will throw `500 Internal Server Error`.

## Testing
Integration tests will be provided for the Controller and Service layer, validating CRUD operations and tenant isolation exactly like the previous modules.
