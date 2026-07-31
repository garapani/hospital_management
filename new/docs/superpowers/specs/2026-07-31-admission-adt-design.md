# Admission (ADT) — Design Specification

## Overview

This module introduces Admission/Discharge/Transfer (ADT) for inpatient (IPD) care, the first Phase 1 module built after the course-correction back to the PRD's stated priority order (§8: "registration → visit → bill"). It covers admitting a patient to a bed, transferring them between beds/wards during their stay, and discharging them with a lightweight administrative/clinical summary.

Scoped tightly to core ADT. Explicitly deferred, per discussion: baby-birth/delivery detail (future Maternity module), death/mortality detail, hemodialysis session tracking, and wristband/SMS notifications (future Notification module) — none of these block the core admit → transfer → discharge loop, and the old system's `AdmissionModels` folder bundles them in only for historical reasons.

## Architecture & Data Flow

Two new pieces, split by ownership:

- **`Bed`** is added to the existing **Master Data** module (`apps/api/src/master-data/`), alongside `Department`/`Ward`. It's static hospital inventory — which beds exist, in which ward — not admission-specific, so it belongs with the other hospital-wide lookups Master Data already owns.
- **`Admission`** and **`BedTransfer`** live in a new `AdmissionsModule` (`apps/api/src/admissions/`), following the same modular-monolith pattern as Appointments/Vitals/Triage: Controller → Service → TypeORM repository, all operations scoped via `TenantConnectionService`. `AdmissionsModule` references `wardId`/`bedId` by ID only — no cross-module entity coupling beyond that, matching how `Vital` references `patientId`/`appointmentId`.

An admission can originate three ways, all converging on the same `Admission` record: direct/standalone (e.g. a planned surgery admission), from an `Appointment` (an OPD doctor decides to admit — `sourceAppointmentId` set), or from a `TriageEntry` (an ER patient is stabilized and admitted — `sourceTriageEntryId` set, and the triage entry's `status` moves to `'Admitted'`, a value already reserved in its lifecycle). At most one of the two source fields may be set.

A bed's `status` tracks occupancy directly: `Occupied` from the moment it's assigned (on admit or transfer-in) until it's freed (on transfer-out or discharge), back to `Available`. A partial unique index on `Admission` (`bedId` where `status = 'Admitted'`) guarantees at most one active admission per bed, so double-booking a bed is a constraint violation, not just an application-level check.

## Data Model

### `Bed` (table: `beds`, owned by Master Data)

- `id`: UUID (Primary Key)
- `wardId`: UUID (Foreign Key → `wards`, required)
- `bedNumber`: varchar (e.g. `"12"`, `"ICU-3"` — unique within a ward, not globally)
- `bedType`: varchar, nullable (e.g. `"General"`, `"ICU"`, `"Isolation"`)
- `status`: varchar, default `'Available'` (`Available` | `Occupied` | `Maintenance`)
- `isActive`: boolean, default `true` (soft-deactivation, matching `Department`/`Ward`)
- `createdAt`: timestamp

### `Admission` (table: `admissions`)

- `id`: UUID (Primary Key)
- `patientId`: UUID (Foreign Key → `patients`, required — no anonymous IPD admissions)
- `admissionSource`: varchar (`OPD` | `ER` | `Direct`)
- `sourceAppointmentId`: UUID, nullable (Foreign Key → `appointments`)
- `sourceTriageEntryId`: UUID, nullable (Foreign Key → `triage_entries`)
- `admittingDoctorId`: UUID (required)
- `wardId`: UUID (current ward)
- `bedId`: UUID (current bed)
- `admissionDate`: timestamptz, defaults to now
- `status`: varchar, default `'Admitted'` (`Admitted` | `Discharged`)
- `dischargeDate`: timestamptz, nullable
- `dischargeType`: varchar, nullable (e.g. `Routine`, `LAMA`, `Transferred-Out`, `Absconded`)
- `dischargeCondition`: varchar, nullable (e.g. `Improved`, `Stable`, `Referred`)
- `dischargeSummary`: text, nullable (free-text summary; structured diagnoses/medications stay with Encounters, not duplicated here)
- `dischargedBy`: UUID, nullable
- `createdAt`, `updatedAt`

### `BedTransfer` (table: `bed_transfers`, append-only history)

- `id`: UUID (Primary Key)
- `admissionId`: UUID (Foreign Key → `admissions`, required)
- `fromBedId`: UUID, nullable (null for the initial admit, which isn't a "transfer")
- `toBedId`: UUID (required)
- `transferredAt`: timestamptz, defaults to now
- `transferredBy`: UUID (required)
- `reason`: text, nullable

## RBAC & Security

**Permissions:**
- `admission.manage`: admit, transfer, discharge
- `admission.read`: view admissions

**Role Mappings:**
- **Doctor**: `admission.manage`, `admission.read`
- **Nurse**: `admission.manage`, `admission.read`
- **Hospital Admin**: `admission.manage`, `admission.read`
- **Super Admin**: `admission.manage`, `admission.read`
- **Receptionist / Front Desk**: `admission.read` (view-only)

Bed CRUD endpoints live under Master Data and are covered by its existing `master-data.manage` / `master-data.read` permissions — no new permission needed for beds themselves.

## API Endpoints

- `POST /admissions` — admit a patient. Body carries `patientId`, `admittingDoctorId`, `wardId`, `bedId`, and at most one of `sourceAppointmentId` / `sourceTriageEntryId`. Requires `admission.manage`.
- `GET /admissions` — list active (non-discharged) admissions, optional `?wardId=` filter. Requires `admission.read`.
- `GET /admissions/:id` — single admission detail. Requires `admission.read`.
- `PATCH /admissions/:id/transfer` — body carries `toBedId` and optional `reason`; frees the current bed, occupies the new one, appends a `BedTransfer` row. Requires `admission.manage`.
- `PATCH /admissions/:id/discharge` — body carries `dischargeType`, `dischargeCondition`, `dischargeSummary`; frees the bed, sets `status: 'Discharged'`. Requires `admission.manage`.
- `POST /wards/:wardId/beds`, `GET /wards/:wardId/beds`, `PATCH /beds/:id/deactivate` — added to the existing `MasterDataController`, following the Department/Ward pattern already there.

## Error Handling

- Assigning a bed that's already `Occupied` (or `Maintenance`) throws `ConflictException`.
- Unknown `admission`/`bed`/`ward`/`patient` IDs throw `NotFoundException`.
- Providing both `sourceAppointmentId` and `sourceTriageEntryId` on create throws `BadRequestException` (an admission has at most one source).
- `Admission.patientId` is always required — an anonymous `TriageEntry` (no `patientId` yet) must go through the existing `PATCH /triage/entries/:id/link-patient` first; admitting from a still-anonymous triage entry throws `BadRequestException`.
- Transferring or discharging an already-discharged admission throws `ConflictException`.

## Testing

Integration tests against real Postgres, tenant-scoped, following the established pattern (see `vitals.service.integration-spec.ts`, `triage.service.integration-spec.ts`):

- `AdmissionsService`: admit via each of the 3 sources; reject double-booking an occupied bed; transfer moves occupancy correctly (old bed freed, new bed occupied, `BedTransfer` row created); discharge frees the bed and sets `dischargeDate`; reject actions on an already-discharged admission; tenant isolation.
- `Bed` CRUD added to the existing `master-data.service.integration-spec.ts`, mirroring `Ward`'s tests.
- Controller specs: permission-gating smoke tests (401/403 without `admission.manage`/`admission.read`), matching the `VitalsController`/`TriageController` pattern.

## Self-Review Notes

- **Placeholder scan:** No missing/TBD details.
- **Internal consistency:** `Admission.wardId`/`bedId` always reflect the *current* location; `BedTransfer` is the append-only history of how it got there. The partial unique index (bed × active admission) is the single source of truth preventing double-booking, not just an application-level check.
- **Scope check:** Deliberately excludes baby-birth, death detail, hemodialysis, and wristband/SMS — flagged as future work, not silently dropped. Structured discharge diagnoses/medications are explicitly left with the (already-built) Encounters module rather than duplicated here.
- **Ambiguity check:** "At most one active admission per bed" and "at most one source (appointment or triage, not both)" are both stated as hard constraints, not soft guidelines.
