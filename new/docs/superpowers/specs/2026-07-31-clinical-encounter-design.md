# Clinical Encounter & Consultations - Design Specification

## Overview
This module introduces the Clinical Encounter subsystem, allowing doctors to record clinical notes, diagnoses, and prescribe medications for a patient visit. It adopts a normalized relational database design to cleanly separate concerns and allow future integration with Pharmacy and Billing modules.

## Architecture & Data Flow
The module will be implemented as a new NestJS module (`EncountersModule`) inside `apps/api/src/clinical/encounters`.
It will expose endpoints to manage the three core entities: Clinical Notes, Diagnoses, and Prescriptions.

All data will be tenant-isolated using the `TenantConnectionService`.

## Data Model (Normalized Approach)

### 1. `ClinicalNote` Entity (Table: `clinical_notes`)
Captures the doctor's qualitative assessment.
- `id`: UUID (PK)
- `patientId`: UUID (FK to Patient)
- `appointmentId`: UUID (FK to Appointment, nullable for walk-ins)
- `doctorId`: UUID (User recording the note)
- `chiefComplaint`: Text
- `historyOfPresentingIllness`: Text
- `physicalExamination`: Text
- `plan`: Text
- `status`: String ('Draft', 'Finalized')
- `createdAt` / `updatedAt`

### 2. `Diagnosis` Entity (Table: `diagnoses`)
Captures the formal diagnosis.
- `id`: UUID (PK)
- `patientId`: UUID
- `appointmentId`: UUID (Nullable)
- `doctorId`: UUID
- `icd10Code`: String (Nullable, for standardized coding)
- `description`: String (Free text or ICD-10 description)
- `isPrimary`: Boolean (Indicates the primary diagnosis for the visit)
- `createdAt` / `updatedAt`

### 3. `Prescription` Entity (Table: `prescriptions`)
Captures prescribed medications.
- `id`: UUID (PK)
- `patientId`: UUID
- `appointmentId`: UUID (Nullable)
- `doctorId`: UUID
- `medicationName`: String (e.g., "Amoxicillin 500mg")
- `dosage`: String (e.g., "1 tablet")
- `frequency`: String (e.g., "TID - Three times a day")
- `route`: String (e.g., "Oral")
- `durationDays`: Integer (e.g., 5)
- `notes`: Text (Nullable, e.g., "Take after food")
- `status`: String ('Active', 'Discontinued')
- `createdAt` / `updatedAt`

## RBAC & Security
**Permissions:**
- `encounter.manage`: Allows creating, updating, and finalizing notes, diagnoses, and prescriptions. (Roles: Doctor, Super Admin)
- `encounter.read`: Allows viewing the encounter records. (Roles: Doctor, Nurse, Hospital Admin, Super Admin)

## API Endpoints
Endpoints will be grouped under the `/encounters` route.
- `POST /encounters/notes`, `GET /encounters/notes/patient/:patientId`
- `POST /encounters/diagnoses`, `GET /encounters/diagnoses/patient/:patientId`
- `POST /encounters/prescriptions`, `GET /encounters/prescriptions/patient/:patientId`

## Future Integration
- **Pharmacy**: The `prescriptions` table can later be linked to a Pharmacy module's dispensing workflow.
- **Billing**: Finalized encounters can trigger automatic billing for consultation fees.
