# Triage / Emergency Module Design

## 1. Overview
The Triage module handles the intake, prioritization, and management of patients arriving at the Emergency Room (ER). The ER operates differently from scheduled outpatient visits, often requiring immediate care before formal registration can occur.

This module introduces a dedicated, isolated `TriageEntry` queue that natively supports anonymous/unregistered patients, a standard 5-level acuity scale, and tracks the lifecycle of an emergency visit.

## 2. Architecture & Approach
We will use **Approach A (Isolated ER/Triage Entity)**.
- ER walk-ins are captured in a `triage_entries` table.
- If the patient is conscious and has an ID, `patientId` is linked immediately.
- If the patient is anonymous, temporary demographics (`firstName`, `lastName`, `gender`, `age`) are recorded directly on the `TriageEntry`.
- Once the patient is stabilized, administrative staff can register the patient and back-link the generated `patientId` to the `TriageEntry`.
- The ER workflow remains fully isolated from the `appointments` system.

## 3. Core Entities

### 3.1. `TriageEntry` (Table: `triage_entries`)
- `id`: UUID (Primary Key)
- `patientId`: UUID (Nullable - Foreign Key to `patients`)
- **Anonymous Demographics** (Nullable, used if `patientId` is null):
  - `firstName`, `lastName`: varchar
  - `gender`: varchar
  - `estimatedAge`: varchar
- **Arrival Details**:
  - `arrivalMode`: varchar (Ambulance, Walk-in, Police, etc.)
  - `broughtBy`: varchar
  - `isPoliceCase`: boolean
- **Clinical/Triage Details**:
  - `chiefComplaint`: text
  - `acuityLevel`: int (1=Resuscitation, 2=Emergent, 3=Urgent, 4=Less Urgent, 5=Non-Urgent)
  - `colorCode`: varchar (Red, Orange, Yellow, Green, Blue)
  - `triagedBy`: UUID (User who performed the triage)
  - `triagedAt`: timestamptz
- **Lifecycle**:
  - `status`: varchar (e.g., 'Arrived', 'Triaged', 'In Treatment', 'Discharged', 'Admitted', 'Deceased')
  - `dischargeRemarks`: text
- `createdAt`, `updatedAt`

## 4. RBAC Permissions
New permissions will be seeded into the RBAC catalog:
- `triage.manage`: Create, update, and manage the triage queue. (Given to ER Doctors, ER Nurses, Super Admin)
- `triage.read`: View the triage queue and metrics. (Given to ER staff, Hospital Admin, Super Admin)

## 5. API Endpoints (Encapsulated in `TriageController`)
- `POST /triage/entries`: Register a new ER arrival (supports both known `patientId` and anonymous demographics).
- `PATCH /triage/entries/:id`: Update triage details (e.g., assign acuity, update status).
- `PATCH /triage/entries/:id/link-patient`: Link an anonymous triage entry to a newly registered `patientId`.
- `GET /triage/entries`: List active triage entries in the queue, ordered by `acuityLevel` (severity) and then `triagedAt`.
- `GET /triage/entries/:id`: Get detailed information about a specific ER visit.

## 6. Self-Review Notes
- **Placeholder scan:** No missing/TBD details.
- **Internal consistency:** The anonymous demographics fields perfectly map to the requirement of handling unregistered patients.
- **Scope check:** This focuses exclusively on the ER queue and triage assessment. It hands off to Clinical Encounters for doctor notes/prescriptions, and to Wards for admission.
- **Ambiguity check:** The 5-level scale is explicitly mapped to integers and colors to prevent frontend/backend mismatch.
